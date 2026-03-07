#import <AVFoundation/AVFoundation.h>
#import <dispatch/dispatch.h>

// Called from Rust inside the memosa process.
// Because this runs in-process and memosa is signed with
// com.apple.security.device.audio-input, macOS shows the TCC dialog
// for Memosa (not for a subprocess).
//
// Returns: 0 = authorized, 1 = denied/restricted
int memosa_request_microphone_access(void) {
    AVAuthorizationStatus status =
        [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];

    if (status == AVAuthorizationStatusAuthorized) {
        return 0;
    }
    if (status == AVAuthorizationStatusDenied ||
        status == AVAuthorizationStatusRestricted) {
        return 1;
    }

    // notDetermined — show the macOS permission dialog.
    // Block the calling thread until the user responds.
    dispatch_semaphore_t sema = dispatch_semaphore_create(0);
    __block BOOL granted = NO;
    [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio
                            completionHandler:^(BOOL g) {
        granted = g;
        dispatch_semaphore_signal(sema);
    }];
    dispatch_semaphore_wait(sema, DISPATCH_TIME_FOREVER);
    return granted ? 0 : 1;
}
