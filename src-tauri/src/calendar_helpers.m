// calendar_helpers.m: the Mac's own calendars through EventKit (sandbox-safe).
// Covers every account added to macOS Calendar (iCloud, Google, Exchange) and
// asks for calendar permission the standard way.
//
//   memosa_calendar_status         0 not asked, 1 restricted, 2 denied, 3 granted, 4 add-only
//   memosa_calendar_request        asks (blocks until the user answers), returns the status
//   memosa_calendar_events_json    JSON array of events between two Unix times; free with free()

#import <Foundation/Foundation.h>
#import <EventKit/EventKit.h>
#include <stdlib.h>
#include <string.h>

static EKEventStore *store(void) {
    static EKEventStore *s = nil;
    static dispatch_once_t once;
    dispatch_once(&once, ^{ s = [[EKEventStore alloc] init]; });
    return s;
}

int memosa_calendar_status(void) {
    EKAuthorizationStatus st = [EKEventStore authorizationStatusForEntityType:EKEntityTypeEvent];
    switch (st) {
        case EKAuthorizationStatusNotDetermined: return 0;
        case EKAuthorizationStatusRestricted: return 1;
        case EKAuthorizationStatusDenied: return 2;
        default: break;
    }
    // 3 = Authorized (before macOS 14) / FullAccess, 4 = WriteOnly (macOS 14+).
    // Raw values, because @available needs a runtime symbol this build does not link.
    return ((NSInteger)st == 4) ? 4 : 3;
}

int memosa_calendar_request(void) {
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    void (^finish)(BOOL, NSError *) = ^(BOOL granted, NSError *error) { (void)granted; (void)error; dispatch_semaphore_signal(done); };
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wunguarded-availability-new"
    if ([store() respondsToSelector:@selector(requestFullAccessToEventsWithCompletion:)]) {
        [store() requestFullAccessToEventsWithCompletion:finish];
    } else {
        [store() requestAccessToEntityType:EKEntityTypeEvent completion:finish];
    }
#pragma clang diagnostic pop
    // The user may take a while to answer; never block forever.
    dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(300 * NSEC_PER_SEC)));
    return memosa_calendar_status();
}

char *memosa_calendar_events_json(double from_unix, double to_unix) {
    @autoreleasepool {
        if (memosa_calendar_status() != 3) return NULL;
        NSDate *from = [NSDate dateWithTimeIntervalSince1970:from_unix];
        NSDate *to = [NSDate dateWithTimeIntervalSince1970:to_unix];
        NSPredicate *pred = [store() predicateForEventsWithStartDate:from endDate:to calendars:nil];
        NSArray<EKEvent *> *events = [[store() eventsMatchingPredicate:pred]
            sortedArrayUsingSelector:@selector(compareStartDateWithEvent:)];
        NSISO8601DateFormatter *iso = [[NSISO8601DateFormatter alloc] init];
        NSMutableArray *out = [NSMutableArray array];
        for (EKEvent *e in events) {
            if (e.isAllDay) continue;
            NSMutableArray *people = [NSMutableArray array];
            for (EKParticipant *p in e.attendees ?: @[]) {
                NSString *name = p.name.length ? p.name : (p.URL.resourceSpecifier ?: @"");
                if (name.length) [people addObject:name];
            }
            [out addObject:@{
                @"id": e.calendarItemExternalIdentifier ?: (e.eventIdentifier ?: @""),
                @"title": e.title ?: @"",
                @"start": [iso stringFromDate:e.startDate],
                @"end": [iso stringFromDate:e.endDate],
                @"attendees": people,
                @"location": e.location ?: @"",
                @"description": e.notes ?: (e.URL.absoluteString ?: @""),
                @"calendar_name": e.calendar.title ?: @"",
            }];
        }
        NSData *json = [NSJSONSerialization dataWithJSONObject:out options:0 error:nil];
        if (!json) return NULL;
        char *buf = malloc(json.length + 1);
        memcpy(buf, json.bytes, json.length);
        buf[json.length] = 0;
        return buf;
    }
}
