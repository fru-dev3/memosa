// macos_helpers.m
// In-process ObjC helpers for macOS App Store sandbox compliance.
//   memosa_convert_to_whisper_format — replaces `ffmpeg -ar 16000 -ac 1 -f f32le` for whisper
//   memosa_free_buffer               — frees the buffer returned by the above
// Replaces every std::process::Command call that is forbidden in the MAS sandbox.
//
// Functions provided:
//   memosa_get_frontmost_app  — replaces osascript frontmost-app query
//   memosa_free_string        — frees strings returned by the above
//   memosa_play_system_ping   — replaces `afplay /System/Library/Sounds/Ping.aiff`
//   memosa_reveal_in_finder   — replaces `open <dir>` (shows folder in Finder)
//   memosa_open_url           — replaces `open <url>` (opens URL in default browser)
//   memosa_encode_wav_to_m4a  — replaces `ffmpeg -c:a aac` WAV→M4A encoding
//   memosa_get_audio_peak_db  — replaces `ffmpeg -af volumedetect` peak detection

#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#import <AudioToolbox/AudioToolbox.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// ---------------------------------------------------------------------------
// Frontmost application detection
// Replaces: osascript "tell application System Events to get frontmost app"
// Returns a malloc'd C string the caller must free with memosa_free_string(),
// or NULL if detection fails.
// ---------------------------------------------------------------------------
const char *memosa_get_frontmost_app(void) {
    @autoreleasepool {
        NSRunningApplication *app = [[NSWorkspace sharedWorkspace] frontmostApplication];
        if (!app) return NULL;
        NSString *name = app.localizedName;
        if (!name || name.length == 0) return NULL;
        const char *utf8 = [name UTF8String];
        if (!utf8) return NULL;
        return strdup(utf8);
    }
}

void memosa_free_string(const char *s) {
    free((void *)s);
}

// ---------------------------------------------------------------------------
// System test tone
// Replaces: afplay /System/Library/Sounds/Ping.aiff
// ---------------------------------------------------------------------------
void memosa_play_system_ping(void) {
    @autoreleasepool {
        NSSound *sound = [NSSound soundNamed:@"Ping"];
        [sound play];
    }
}

// ---------------------------------------------------------------------------
// Reveal a path in Finder
// Replaces: open <path>  (used by open_in_finder)
// ---------------------------------------------------------------------------
void memosa_reveal_in_finder(const char *path_str) {
    @autoreleasepool {
        NSString *pathNS = [NSString stringWithUTF8String:path_str];
        NSURL *url = [NSURL fileURLWithPath:pathNS];
        [[NSWorkspace sharedWorkspace] activateFileViewerSelectingURLs:@[url]];
    }
}

// ---------------------------------------------------------------------------
// Open a URL in the default browser
// Replaces: open::that(&url)  (used by open_external_url command)
// ---------------------------------------------------------------------------
void memosa_open_url(const char *url_str) {
    @autoreleasepool {
        NSString *urlNS = [NSString stringWithUTF8String:url_str];
        NSURL *url = [NSURL URLWithString:urlNS];
        if (url) {
            [[NSWorkspace sharedWorkspace] openURL:url];
        }
    }
}

// ---------------------------------------------------------------------------
// WAV → M4A (AAC) encoding via ExtAudioFile
// Replaces: ffmpeg -i input.wav -ac 1 -c:a aac -b:a 128k output.m4a
//
// Returns 0 on success.  On error, writes a NUL-terminated message into
// error_out (up to error_len bytes) and returns -1.
// ---------------------------------------------------------------------------
int memosa_encode_wav_to_m4a(const char *input_path,
                              const char *output_path,
                              char *error_out,
                              int error_len)
{
    @autoreleasepool {
        NSURL *inURL  = [NSURL fileURLWithPath:[NSString stringWithUTF8String:input_path]];
        NSURL *outURL = [NSURL fileURLWithPath:[NSString stringWithUTF8String:output_path]];

        // Remove any pre-existing output so the create call doesn't fail.
        [[NSFileManager defaultManager] removeItemAtURL:outURL error:nil];

        // ----- Open source WAV -----
        ExtAudioFileRef srcFile = NULL;
        OSStatus st = ExtAudioFileOpenURL((__bridge CFURLRef)inURL, &srcFile);
        if (st != noErr) {
            snprintf(error_out, error_len, "ExtAudioFileOpenURL failed: %d", (int)st);
            return -1;
        }

        // Read the on-disk format so we know the native sample rate and channel count.
        AudioStreamBasicDescription srcFmt = {0};
        UInt32 propSize = sizeof(srcFmt);
        st = ExtAudioFileGetProperty(srcFile,
                                     kExtAudioFileProperty_FileDataFormat,
                                     &propSize, &srcFmt);
        if (st != noErr) {
            ExtAudioFileDispose(srcFile);
            snprintf(error_out, error_len, "GetProperty FileDataFormat failed: %d", (int)st);
            return -1;
        }

        // ----- Create destination M4A / AAC -----
        // Encode as mono AAC at the source sample rate.
        // CoreAudio's built-in resampler and mixer handle SRC and downmix.
        AudioStreamBasicDescription dstFmt = {0};
        dstFmt.mFormatID         = kAudioFormatMPEG4AAC;
        dstFmt.mSampleRate       = srcFmt.mSampleRate;
        dstFmt.mChannelsPerFrame = 1;

        ExtAudioFileRef dstFile = NULL;
        st = ExtAudioFileCreateWithURL((__bridge CFURLRef)outURL,
                                       kAudioFileM4AType,
                                       &dstFmt,
                                       NULL,
                                       kAudioFileFlags_EraseFile,
                                       &dstFile);
        if (st != noErr) {
            ExtAudioFileDispose(srcFile);
            snprintf(error_out, error_len, "ExtAudioFileCreateWithURL failed: %d", (int)st);
            return -1;
        }

        // ----- Set client format on both files: PCM float32 mono -----
        // ExtAudioFile will downmix from stereo and convert from integer formats
        // to this client representation transparently.
        AudioStreamBasicDescription clientFmt = {0};
        clientFmt.mFormatID         = kAudioFormatLinearPCM;
        clientFmt.mFormatFlags      = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked;
        clientFmt.mSampleRate       = srcFmt.mSampleRate;
        clientFmt.mChannelsPerFrame = 1;
        clientFmt.mBitsPerChannel   = 32;
        clientFmt.mFramesPerPacket  = 1;
        clientFmt.mBytesPerFrame    = sizeof(float);
        clientFmt.mBytesPerPacket   = sizeof(float);

        st = ExtAudioFileSetProperty(srcFile,
                                     kExtAudioFileProperty_ClientDataFormat,
                                     sizeof(clientFmt), &clientFmt);
        if (st != noErr) {
            ExtAudioFileDispose(srcFile);
            ExtAudioFileDispose(dstFile);
            snprintf(error_out, error_len, "Set src ClientDataFormat failed: %d", (int)st);
            return -1;
        }

        st = ExtAudioFileSetProperty(dstFile,
                                     kExtAudioFileProperty_ClientDataFormat,
                                     sizeof(clientFmt), &clientFmt);
        if (st != noErr) {
            ExtAudioFileDispose(srcFile);
            ExtAudioFileDispose(dstFile);
            snprintf(error_out, error_len, "Set dst ClientDataFormat failed: %d", (int)st);
            return -1;
        }

        // ----- Copy in chunks -----
        const UInt32 kFramesPerChunk = 8192;
        const UInt32 kBufBytes = kFramesPerChunk * sizeof(float);
        float *buf = (float *)malloc(kBufBytes);
        if (!buf) {
            ExtAudioFileDispose(srcFile);
            ExtAudioFileDispose(dstFile);
            snprintf(error_out, error_len, "Out of memory allocating encode buffer");
            return -1;
        }

        while (1) {
            AudioBufferList abl;
            abl.mNumberBuffers              = 1;
            abl.mBuffers[0].mNumberChannels = 1;
            abl.mBuffers[0].mDataByteSize   = kBufBytes;
            abl.mBuffers[0].mData           = buf;

            UInt32 framesRead = kFramesPerChunk;
            st = ExtAudioFileRead(srcFile, &framesRead, &abl);
            if (st != noErr) {
                free(buf);
                ExtAudioFileDispose(srcFile);
                ExtAudioFileDispose(dstFile);
                snprintf(error_out, error_len, "ExtAudioFileRead failed: %d", (int)st);
                return -1;
            }
            if (framesRead == 0) break;  // EOF

            abl.mBuffers[0].mDataByteSize = framesRead * sizeof(float);
            st = ExtAudioFileWrite(dstFile, framesRead, &abl);
            if (st != noErr) {
                free(buf);
                ExtAudioFileDispose(srcFile);
                ExtAudioFileDispose(dstFile);
                snprintf(error_out, error_len, "ExtAudioFileWrite failed: %d", (int)st);
                return -1;
            }
        }

        free(buf);
        ExtAudioFileDispose(srcFile);
        ExtAudioFileDispose(dstFile);
        return 0;
    }
}

// ---------------------------------------------------------------------------
// Audio peak level detection (dBFS)
// Replaces: ffmpeg -af volumedetect  (used by inspect_audio_signal)
//
// Reads all samples via ExtAudioFile, computes the absolute peak, converts to
// dBFS, and writes the result to *peak_out.
// Returns 0 on success, -1 on error.
// ---------------------------------------------------------------------------
int memosa_get_audio_peak_db(const char *path_str,
                              float *peak_out,
                              char *error_out,
                              int error_len)
{
    @autoreleasepool {
        NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path_str]];

        ExtAudioFileRef af = NULL;
        OSStatus st = ExtAudioFileOpenURL((__bridge CFURLRef)url, &af);
        if (st != noErr) {
            snprintf(error_out, error_len, "ExtAudioFileOpenURL failed: %d", (int)st);
            return -1;
        }

        // Get source sample rate so we can set client format correctly.
        AudioStreamBasicDescription srcFmt = {0};
        UInt32 propSize = sizeof(srcFmt);
        ExtAudioFileGetProperty(af, kExtAudioFileProperty_FileDataFormat, &propSize, &srcFmt);

        // Client: PCM f32 mono.
        AudioStreamBasicDescription fmt = {0};
        fmt.mFormatID         = kAudioFormatLinearPCM;
        fmt.mFormatFlags      = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked;
        fmt.mSampleRate       = srcFmt.mSampleRate > 0 ? srcFmt.mSampleRate : 44100.0;
        fmt.mChannelsPerFrame = 1;
        fmt.mBitsPerChannel   = 32;
        fmt.mFramesPerPacket  = 1;
        fmt.mBytesPerFrame    = sizeof(float);
        fmt.mBytesPerPacket   = sizeof(float);
        ExtAudioFileSetProperty(af, kExtAudioFileProperty_ClientDataFormat, sizeof(fmt), &fmt);

        const UInt32 kBufFrames = 8192;
        float buf[8192];
        float peak = 0.0f;

        while (1) {
            AudioBufferList abl;
            abl.mNumberBuffers              = 1;
            abl.mBuffers[0].mNumberChannels = 1;
            abl.mBuffers[0].mDataByteSize   = kBufFrames * sizeof(float);
            abl.mBuffers[0].mData           = buf;

            UInt32 frames = kBufFrames;
            st = ExtAudioFileRead(af, &frames, &abl);
            if (st != noErr || frames == 0) break;

            for (UInt32 i = 0; i < frames; i++) {
                float abs_val = fabsf(buf[i]);
                if (abs_val > peak) peak = abs_val;
            }
        }

        ExtAudioFileDispose(af);

        *peak_out = (peak > 0.0f) ? (20.0f * log10f(peak)) : -100.0f;
        return 0;
    }
}

// ---------------------------------------------------------------------------
// Audio → 16 kHz mono f32 PCM (for whisper.cpp)
// Replaces: ffmpeg -ar 16000 -ac 1 -f f32le - (piped to stdout)
//
// Allocates a buffer via malloc; caller must release it with memosa_free_buffer.
// On success: *samples_out points to the buffer, *frames_out is the frame count,
// returns 0.  On error: writes to error_out and returns -1.
// ---------------------------------------------------------------------------
int memosa_convert_to_whisper_format(const char *path_str,
                                      float **samples_out,
                                      int64_t *frames_out,
                                      char *error_out,
                                      int error_len)
{
    @autoreleasepool {
        NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path_str]];

        ExtAudioFileRef af = NULL;
        OSStatus st = ExtAudioFileOpenURL((__bridge CFURLRef)url, &af);
        if (st != noErr) {
            snprintf(error_out, error_len, "ExtAudioFileOpenURL failed: %d", (int)st);
            return -1;
        }

        // Client format: 16 kHz mono f32 — exactly what whisper.cpp needs.
        AudioStreamBasicDescription clientFmt = {0};
        clientFmt.mFormatID         = kAudioFormatLinearPCM;
        clientFmt.mFormatFlags      = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked;
        clientFmt.mSampleRate       = 16000.0;
        clientFmt.mChannelsPerFrame = 1;
        clientFmt.mBitsPerChannel   = 32;
        clientFmt.mFramesPerPacket  = 1;
        clientFmt.mBytesPerFrame    = sizeof(float);
        clientFmt.mBytesPerPacket   = sizeof(float);

        st = ExtAudioFileSetProperty(af,
                                     kExtAudioFileProperty_ClientDataFormat,
                                     sizeof(clientFmt), &clientFmt);
        if (st != noErr) {
            ExtAudioFileDispose(af);
            snprintf(error_out, error_len, "Set ClientDataFormat failed: %d", (int)st);
            return -1;
        }

        // Pre-size the buffer using the file's frame count if available.
        // For compressed formats this may be 0; we'll grow dynamically.
        SInt64 fileFrames = 0;
        UInt32 propSize = sizeof(fileFrames);
        ExtAudioFileGetProperty(af, kExtAudioFileProperty_FileLengthFrames, &propSize, &fileFrames);

        const UInt32 kChunkFrames = 16000; // 1 s of 16 kHz audio
        // Estimate capacity: file_frames resampled to 16 kHz, defaulting to 5 min.
        size_t capacity = (fileFrames > 0) ? (size_t)(fileFrames + kChunkFrames)
                                           : (size_t)kChunkFrames * 300;

        float *buf = (float *)malloc(capacity * sizeof(float));
        if (!buf) {
            ExtAudioFileDispose(af);
            snprintf(error_out, error_len, "Out of memory allocating whisper buffer");
            return -1;
        }

        size_t total = 0;
        while (1) {
            // Grow buffer if needed.
            if (total + kChunkFrames > capacity) {
                capacity = capacity * 2 + kChunkFrames;
                float *grown = (float *)realloc(buf, capacity * sizeof(float));
                if (!grown) {
                    free(buf);
                    ExtAudioFileDispose(af);
                    snprintf(error_out, error_len, "Out of memory growing whisper buffer");
                    return -1;
                }
                buf = grown;
            }

            AudioBufferList abl;
            abl.mNumberBuffers              = 1;
            abl.mBuffers[0].mNumberChannels = 1;
            abl.mBuffers[0].mDataByteSize   = kChunkFrames * sizeof(float);
            abl.mBuffers[0].mData           = buf + total;

            UInt32 framesRead = kChunkFrames;
            st = ExtAudioFileRead(af, &framesRead, &abl);
            if (st != noErr || framesRead == 0) break;
            total += framesRead;
        }

        ExtAudioFileDispose(af);

        *samples_out = buf;
        *frames_out  = (int64_t)total;
        return 0;
    }
}

void memosa_free_buffer(void *buf) {
    free(buf);
}

// ---------------------------------------------------------------------------
// Security-scoped bookmarks (MAS sandbox persistence)
// ---------------------------------------------------------------------------

/// Create an app-scoped security-scoped bookmark from a filesystem path.
/// Returns bookmark bytes via out params. Caller must free *data_out with free().
/// Returns 0 on success, -1 on error.
int memosa_create_security_bookmark(const char *path, uint8_t **data_out, int *len_out,
                                     char *error_out, int error_len) {
    @autoreleasepool {
        NSString *nsPath = [NSString stringWithUTF8String:path];
        NSURL *url = [NSURL fileURLWithPath:nsPath];
        NSError *err = nil;
        NSData *bookmark = [url bookmarkDataWithOptions:NSURLBookmarkCreationWithSecurityScope
                         includingResourceValuesForKeys:nil
                                          relativeToURL:nil
                                                  error:&err];
        if (!bookmark) {
            snprintf(error_out, error_len, "Failed to create bookmark: %s",
                     [[err localizedDescription] UTF8String]);
            return -1;
        }
        NSUInteger blen = [bookmark length];
        uint8_t *copy = (uint8_t *)malloc(blen);
        if (!copy) {
            snprintf(error_out, error_len, "Out of memory");
            return -1;
        }
        memcpy(copy, [bookmark bytes], blen);
        *data_out = copy;
        *len_out = (int)blen;
        return 0;
    }
}

/// Resolve a security-scoped bookmark back to a path.
/// Returns 0 on success, -1 on error. *stale_out is set to 1 if the bookmark is stale.
/// The resolved path is written to path_out (must be at least path_out_len bytes).
int memosa_resolve_security_bookmark(const uint8_t *data, int data_len,
                                      char *path_out, int path_out_len,
                                      int *stale_out,
                                      char *error_out, int error_len) {
    @autoreleasepool {
        NSData *bookmarkData = [NSData dataWithBytes:data length:(NSUInteger)data_len];
        BOOL isStale = NO;
        NSError *err = nil;
        NSURL *url = [NSURL URLByResolvingBookmarkData:bookmarkData
                                               options:NSURLBookmarkResolutionWithSecurityScope
                                         relativeToURL:nil
                                   bookmarkDataIsStale:&isStale
                                                 error:&err];
        if (!url) {
            snprintf(error_out, error_len, "Failed to resolve bookmark: %s",
                     [[err localizedDescription] UTF8String]);
            return -1;
        }
        *stale_out = isStale ? 1 : 0;
        // Start accessing the security-scoped resource
        [url startAccessingSecurityScopedResource];
        const char *resolved = [[url path] UTF8String];
        if (!resolved) {
            snprintf(error_out, error_len, "Resolved URL has no path");
            return -1;
        }
        snprintf(path_out, path_out_len, "%s", resolved);
        return 0;
    }
}
