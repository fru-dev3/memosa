// memosa-ai: Memosa's link to what macOS has built in. Nothing leaves the Mac.
//
//   memosa-ai                    reads a prompt on stdin, answers with Apple's
//                                on-device model (Apple Intelligence) on stdout.
//   memosa-ai transcribe <file> [names...]
//                                transcribes an audio file with Apple's speech
//                                recognition; prints [{"start","end","text"}] as JSON.
//                                Names (people, accounts) help it spell them right.
//
// Exit 2 when the feature can't be used on this Mac (the reason goes to stderr),
// 3 when a prompt is too long for the model, 1 on any other failure. Built by
// build.rs and shipped next to the app's binary.
import AVFoundation
import Foundation
import FoundationModels
import Speech

func fail(_ message: String, _ code: Int32) -> Never {
    FileHandle.standardError.write(Data(message.utf8))
    exit(code)
}

@main
struct MemosaAI {
    static func main() async {
        let args = CommandLine.arguments
        if args.count >= 3, args[1] == "transcribe" {
            await transcribe(URL(fileURLWithPath: args[2]), names: Array(args.dropFirst(3)))
        } else {
            await answer()
        }
    }

    static func answer() async {
        let prompt = String(decoding: FileHandle.standardInput.readDataToEndOfFile(), as: UTF8.self)
        if prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { fail("Empty prompt.", 1) }
        switch SystemLanguageModel.default.availability {
        case .available:
            break
        case .unavailable(.appleIntelligenceNotEnabled):
            fail("Turn on Apple Intelligence in System Settings to write summaries on this Mac.", 2)
        case .unavailable(.modelNotReady):
            fail("Apple's on-device model is still downloading. Try again in a few minutes.", 2)
        case .unavailable(.deviceNotEligible):
            fail("This Mac can't run Apple's on-device model.", 2)
        case .unavailable:
            fail("Apple's on-device model isn't available right now.", 2)
        }
        do {
            let session = LanguageModelSession()
            let answer = try await session.respond(to: prompt)
            print(answer.content)
        } catch LanguageModelSession.GenerationError.exceededContextWindowSize {
            fail("too long", 3)
        } catch {
            fail("On-device AI failed: \(error.localizedDescription)", 1)
        }
    }

    struct Line: Encodable {
        let start: Double
        let end: Double
        let text: String
    }

    static func transcribe(_ url: URL, names: [String]) async {
        guard SpeechTranscriber.isAvailable else { fail("Speech recognition isn't available on this Mac.", 2) }
        let locale = await SpeechTranscriber.supportedLocale(equivalentTo: .current)
        let fallback = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: "en-US"))
        guard let locale = locale ?? fallback else { fail("Speech recognition doesn't support this language.", 2) }
        let transcriber = SpeechTranscriber(locale: locale, transcriptionOptions: [], reportingOptions: [], attributeOptions: [.audioTimeRange])
        do {
            // The speech model is part of macOS but downloaded on first use.
            if await AssetInventory.status(forModules: [transcriber]) != .installed,
               let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
                try await request.downloadAndInstall()
            }
            let audio = try AVAudioFile(forReading: url)
            let collect = Task {
                var lines: [Line] = []
                for try await result in transcriber.results where result.isFinal {
                    let text = String(result.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
                    if text.isEmpty { continue }
                    lines.append(Line(start: CMTimeGetSeconds(result.range.start), end: CMTimeGetSeconds(result.range.end), text: text))
                }
                return lines
            }
            let analyzer = SpeechAnalyzer(modules: [transcriber])
            if !names.isEmpty {
                let context = AnalysisContext()
                context.contextualStrings[.general] = names
                try await analyzer.setContext(context)
            }
            try await analyzer.start(inputAudioFile: audio, finishAfterFile: true)
            let lines = try await collect.value
            let json = try JSONEncoder().encode(lines)
            FileHandle.standardOutput.write(json)
        } catch {
            fail("Transcription failed: \(error.localizedDescription)", 1)
        }
    }
}
