//! Keeps an Objective-C exception inside AppKit's event dispatch from killing the app.
//!
//! tao's `sendEvent:` override is `extern "C"`, so an NSException thrown under it can't reach
//! the handler in `-[NSApplication run]` that would log it and carry on: Rust aborts at the
//! boundary with "panic in a function that cannot unwind". The two AppKit methods tao calls are
//! wrapped here, below that boundary, so the exception stops where AppKit would have stopped it,
//! and its name, reason and stack go to panic.log.

use std::panic::{AssertUnwindSafe, UnwindSafe};
use std::sync::atomic::{AtomicUsize, Ordering};

use objc2::exception::{self, Exception};
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
use objc2::{msg_send, sel};

use crate::panic_log;

type SendEvent = unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject);

static APP_SEND_EVENT: AtomicUsize = AtomicUsize::new(0);
static WINDOW_SEND_EVENT: AtomicUsize = AtomicUsize::new(0);

fn describe(thrown: Option<Retained<Exception>>) -> String {
    let Some(thrown) = thrown else { return "nil exception".into() };
    let mut text = format!("{thrown:?}");
    let object: &AnyObject = (*thrown).as_ref();
    // SAFETY: both messages are sent to live objects, and callStackSymbols only after asking.
    unsafe {
        let has_stack: bool = msg_send![object, respondsToSelector: sel!(callStackSymbols)];
        if has_stack {
            let stack: Option<Retained<AnyObject>> = msg_send![object, callStackSymbols];
            if let Some(stack) = stack {
                text.push_str(&format!("\n{stack:?}"));
            }
        }
    }
    text
}

/// Runs `call`; returns a description of the Objective-C exception it threw, if any.
fn shield(call: impl FnOnce() + UnwindSafe) -> Option<String> {
    exception::catch(call).err().map(describe)
}

unsafe fn dispatch(original: &AtomicUsize, this: *mut AnyObject, sel: Sel, event: *mut AnyObject) {
    // SAFETY: `install` stored this method's own implementation before swapping it out.
    let call: SendEvent = unsafe { std::mem::transmute(original.load(Ordering::Acquire)) };
    let thrown = shield(AssertUnwindSafe(|| unsafe { call(this, sel, event) }));
    if let Some(text) = thrown {
        panic_log::append(&format!("=== Objective-C exception in sendEvent: (survived, pid {})\n{text}\n\n", std::process::id()));
    }
}

unsafe extern "C-unwind" fn app_send_event(this: *mut AnyObject, sel: Sel, event: *mut AnyObject) {
    unsafe { dispatch(&APP_SEND_EVENT, this, sel, event) }
}

unsafe extern "C-unwind" fn window_send_event(this: *mut AnyObject, sel: Sel, event: *mut AnyObject) {
    unsafe { dispatch(&WINDOW_SEND_EVENT, this, sel, event) }
}

/// Call once, before the event loop starts.
pub fn install() {
    let targets: [(&std::ffi::CStr, &AtomicUsize, SendEvent); 2] =
        [(c"NSApplication", &APP_SEND_EVENT, app_send_event), (c"NSWindow", &WINDOW_SEND_EVENT, window_send_event)];
    for (class, original, guard) in targets {
        let Some(method) = AnyClass::get(class).and_then(|c| c.instance_method(sel!(sendEvent:))) else { continue };
        original.store(method.implementation() as usize, Ordering::Release);
        // SAFETY: same signature as the method it replaces, which it goes on to call.
        unsafe { method.set_implementation(std::mem::transmute::<SendEvent, Imp>(guard)) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use objc2::class;
    use std::ffi::CString;

    fn ns_string(s: &str) -> *mut AnyObject {
        let s = CString::new(s).unwrap();
        unsafe { msg_send![class!(NSString), stringWithUTF8String: s.as_ptr()] }
    }

    #[test]
    fn a_thrown_nsexception_is_stopped_and_described() {
        let text = shield(|| {
            let e: *mut Exception = unsafe {
                msg_send![class!(NSException), exceptionWithName: ns_string("TestFailure"), reason: ns_string("bad range"), userInfo: std::ptr::null_mut::<AnyObject>()]
            };
            exception::throw(unsafe { Retained::retain(e) }.unwrap())
        })
        .expect("the exception was caught");
        assert!(text.contains("TestFailure"), "{text}");
        assert!(text.contains("bad range"), "{text}");
    }

    #[test]
    fn a_normal_call_reports_nothing() {
        assert_eq!(shield(|| {}), None);
    }
}
