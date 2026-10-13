// Toolbar click runs the check on the active tab. A second click clears it.
// activeTab means the extension only touches a page when someone clicks it.

const RED = '#b42318';
const AMBER = '#b54708';
const GREEN = '#067647';
const DEFAULT_TITLE = 'Run Scottsdale style check (click again to clear)';

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || tab.id == null) return;
  const target = { tabId: tab.id };
  try {
    const [probe] = await chrome.scripting.executeScript({
      target,
      func: () => !!globalThis.__ssc,
    });
    if (probe && probe.result) {
      await chrome.scripting.executeScript({
        target,
        func: () => globalThis.__ssc.toggle(),
      });
      return;
    }
    await chrome.scripting.insertCSS({ target, files: ['content.css'] });
    await chrome.scripting.executeScript({ target, files: ['rules.js', 'content.js'] });
  } catch (err) {
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: RED });
    await chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
    await chrome.action.setTitle({
      tabId: tab.id,
      title: "The style check can't run on this page. Browser pages and the web store are blocked.",
    });
    setTimeout(() => {
      chrome.action.setBadgeText({ tabId: tab.id, text: '' }).catch(() => {});
      chrome.action.setTitle({ tabId: tab.id, title: DEFAULT_TITLE }).catch(() => {});
    }, 4000);
  }
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'open-options') {
    chrome.runtime.openOptionsPage();
    return;
  }
  if (msg.type === 'badge' && sender.tab && sender.tab.id != null) {
    const tabId = sender.tab.id;
    const color = msg.state === 'error' ? RED : msg.state === 'review' ? AMBER : GREEN;
    chrome.action.setBadgeText({ tabId, text: String(msg.text || '') }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
  }
});
