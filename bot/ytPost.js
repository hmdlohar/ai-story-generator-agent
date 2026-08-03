import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import puppeteer from "puppeteer";
import { loadProject } from "./ytMetadata.js";
import path from "node:path";
import os from "node:os";
import fetch from "node-fetch";

const DEFAULT_CDP_URL = "http://127.0.0.1:9222";
const DEFAULT_PROJECTS_ROOT = "storage/projects";
const DEFAULT_CHANNEL_ID = "UCT_fsoXVMZxbQ94S1uVKBfA";

// Known Chrome binaries to try (in order) when we need to self-launch.
const CHROME_CANDIDATES = [
  "google-chrome-unstable",
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
];

// Wait until the CDP endpoint responds.
async function waitForCdp(cdpUrl, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${cdpUrl}/json/version`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

// Find an available Chrome binary, or null.
function findChromeBinary() {
  for (const name of CHROME_CANDIDATES) {
    const bin = `/usr/bin/${name}`;
    if (existsSync(bin)) return bin;
  }
  // Try resolving via PATH as a last resort
  for (const name of CHROME_CANDIDATES) {
    const path = process.env.PATH.split(":")
      .map((d) => `${d}/${name}`)
      .find(existsSync);
    if (path) return path;
  }
  return null;
}

// Find the main PID of a running Chrome binary (not a child process).
function findChromeMainPid(chromeBin) {
  const proc = spawn("pgrep", ["-f", `${chromeBin} --`], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve) => {
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.on("close", () => {
      const pids = out
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      resolve(pids.length ? Number(pids[0]) : null);
    });
  });
}

// Wait for a Chrome main process to exit.
async function waitForPidExit(pid, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0); // still alive
      await new Promise((r) => setTimeout(r, 500));
    } catch {
      return true; // gone
    }
  }
  return false;
}

// Ensure a Chrome instance with the CDP port is running; launch one if not.
// The port is only honored by the FIRST Chrome process for a profile, so if
// the browser is already running without CDP we must quit it and relaunch
// with the port — the profile (and its login) is preserved.
// Returns the connected browser via puppeteer.
async function connectWithAutoLaunch(cdpUrl) {
  const port = new URL(cdpUrl).port;
  const url = cdpUrl;
  if (await waitForCdp(url, 3000)) {
    return puppeteer.connect({ browserURL: url, defaultViewport: null });
  }
  const chromeBin = findChromeBinary();
  if (!chromeBin) {
    throw new Error(
      `No Chrome binary found. Start Chrome with --remote-debugging-port=${port} manually, or install google-chrome-unstable.`,
    );
  }

  // If the browser is already running (without CDP), quit it first so the
  // relaunch with the port is the first process for its profile.
  const existingPid = await findChromeMainPid(chromeBin);
  if (existingPid) {
    console.log(
      `Chrome is running without CDP (pid ${existingPid}). Quitting it so we can relaunch with the debugging port...`,
    );
    try {
      process.kill(existingPid, "SIGTERM");
    } catch {
      /* already gone */
    }
    if (!(await waitForPidExit(existingPid, 15000))) {
      throw new Error(
        `Could not quit the running Chrome (pid ${existingPid}). Close it manually and retry.`,
      );
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log(
    `Launching ${chromeBin} with remote debugging on port ${port}...`,
  );
  // Dedicated bot profile so the automation never hits the real browser's
  // windows/popups, and its login state is preserved between runs.
  // const profileDir = path.join(os.homedir(), ".config", "story-gen-bot-chrome");
  const chromeProc = spawn(
    chromeBin,
    [
      `--remote-debugging-port=${port}`,
      // `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--no-restore-session-state",
      "about:blank",
    ],
    { stdio: "ignore", detached: true },
  );
  chromeProc.unref();
  if (!(await waitForCdp(url, 45000))) {
    throw new Error(
      `Chrome launched but CDP did not come up on ${url} within 45s`,
    );
  }
  console.log("Chrome is up with CDP. Connecting...");
  return puppeteer.connect({ browserURL: url, defaultViewport: null });
}

// Set the value of a Polymer paper-input's inner <input> and fire the events
// the component listens for. Raw keyboard typing gets swallowed by the
// paper-input re-render; setting the value via the native setter + input/
// change events is what actually sticks (verified against live Studio).
// Stale hidden duplicates of these inputs accumulate across runs, so we pick
// the first *visible* match (preferring the active upload dialog's scope).
async function setPaperInputValue(page, inputSelector, value) {
  const ok = await page.evaluate(
    (sel, val) => {
      const scope = document.querySelector("ytcp-uploads-dialog");
      const candidates = [...document.querySelectorAll(sel)];
      const input =
        candidates.find(
          (i) => scope && scope.contains(i) && i.offsetParent !== null,
        ) ||
        candidates.find((i) => i.offsetParent !== null) ||
        candidates.find((i) => scope && scope.contains(i)) ||
        candidates[0];
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      ).set;
      setter.call(input, val);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    inputSelector,
    value,
  );
  if (!ok) throw new Error(`Schedule input not found: ${inputSelector}`);
}

// Set the schedule date. The date field is a dropdown trigger that opens a
// calendar dialog; the calendar's "Enter date" paper-input accepts a
// day-first label like "2 Aug 2026".
async function typeScheduleDate(page, date) {
  // Open the calendar via the datepicker trigger. There can be stale hidden
  // #datepicker-trigger duplicates left over from previous runs, so scope the
  // lookup to the visible one inside the active upload dialog.
  await page.waitForFunction(
    () => {
      const dlg = document.querySelector("ytcp-uploads-dialog");
      if (!dlg || dlg.offsetParent === null) return false;
      const t = dlg.querySelector("#datepicker-trigger [role=button]");
      if (!t || t.offsetParent === null) return false;
      t.click();
      return true;
    },
    { timeout: 10000 },
  );
  await new Promise((r) => setTimeout(r, 1200));

  const dayFirst = date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }); // "2 Aug 2026"
  // Wait for the calendar dialog to actually open (its input becomes visible).
  await page
    .waitForFunction(
      () =>
        [
          ...document.querySelectorAll(
            'ytcp-date-picker [aria-label="Enter date"] input',
          ),
        ].some((i) => i.offsetParent !== null),
      { timeout: 5000 },
    )
    .catch(() => {});
  await setPaperInputValue(
    page,
    'ytcp-date-picker [aria-label="Enter date"] input',
    dayFirst,
  );
  await new Promise((r) => setTimeout(r, 400));
  await page.keyboard.press("Enter");
  await new Promise((r) => setTimeout(r, 1200));
}

// Set the schedule time. The time field is a directly editable paper-input
// inside ytcp-datetime-picker (no dropdown).
async function typeScheduleTime(page, date) {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  await setPaperInputValue(
    page,
    "ytcp-datetime-picker #time-of-day-container input",
    "",
  );
  await page.type(
    "ytcp-datetime-picker #time-of-day-container input",
    `${hh}:${mm}`,
    { delay: 10 },
  );
  await new Promise((r) => setTimeout(r, 500));
  await page.keyboard.press("Enter");
  await new Promise((r) => setTimeout(r, 500));
  await page.keyboard.press("Tab"); // blur the input so the picker updates its internal state
  await new Promise((r) => setTimeout(r, 800));
}

// Activate a button by exact aria-label via keyboard (focus + Enter).
// Reliable on Studio pages where synthetic mouse clicks can be swallowed.
async function activateByAriaLabel(page, ariaLabel, timeout = 30000) {
  await page.waitForFunction(
    (label) => {
      const el = [...document.querySelectorAll("button")].find(
        (b) =>
          (b.getAttribute("aria-label") || "").trim() === label &&
          b.offsetParent !== null,
      );
      if (!el) return false;
      el.focus();
      return document.activeElement === el;
    },
    { timeout },
    ariaLabel,
  );
  await page.keyboard.press("Enter");
}

// Activate a Create-menu item (tp-yt-paper-item) by test-id.
async function activateMenuItem(page, testId, timeout = 10000) {
  await page.waitForFunction(
    (needle) => {
      const el = [...document.querySelectorAll("tp-yt-paper-item")].find(
        (item) =>
          item.offsetParent !== null && item.getAttribute("test-id") === needle,
      );
      if (!el) return false;
      el.focus();
      return document.activeElement === el;
    },
    { timeout },
    testId,
  );
  await page.keyboard.press("Enter");
}

// Dismiss blocking dialogs/banners and force-remove empty dialogs/backdrops.
async function dismissOverlays(page) {
  await page.evaluate(() => {
    const dialog = [
      ...document.querySelectorAll("ytcp-dialog, ytcp-banner"),
    ].find((el) => el.offsetParent !== null);
    if (dialog) {
      const btn = [...dialog.querySelectorAll("button")].find((b) =>
        /dismiss|close|get started/i.test(
          b.getAttribute("aria-label") || b.innerText || "",
        ),
      );
      if (btn) btn.click();
    }
    for (const d of [...document.querySelectorAll("ytcp-dialog")]) {
      if (d.offsetParent !== null && !(d.innerText || "").trim()) d.remove();
    }
    for (const b of [
      ...document.querySelectorAll("tp-yt-iron-overlay-backdrop.opened"),
    ]) {
      b.remove();
    }
  });
  await new Promise((r) => setTimeout(r, 800));
}

// Click the "Next" navigation button with retry.
async function clickNext(page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await dismissOverlays(page);
    try {
      await activateByAriaLabel(page, "Next", 10000);
      return;
    } catch {
      if (attempt === 2) throw new Error("Could not click Next");
    }
  }
}

/**
 * Uploads a story project video to YouTube and schedules it.
 *
 * @param {object} opts
 * @param {string} opts.projectRef  Project folder name under projectsRoot (e.g. "p20")
 * @param {Date}   opts.scheduleDate When to publish (required for scheduling)
 * @param {string} [opts.projectsRoot='storage/projects']
 * @param {string} [opts.channelId]
 * @param {string} [opts.cdpUrl='http://127.0.0.1:9222']
 * @param {object} [opts.puppeteer]  Existing puppeteer module (optional, for embedding)
 * @returns {Promise<{success: boolean, project?: string, title?: string, videoPath?: string, scheduledFor?: string, videoUrl?: string, stage?: string, error?: string}>}
 */
export async function uploadProject({
  projectRef,
  scheduleDate,
  projectsRoot = DEFAULT_PROJECTS_ROOT,
  channelId = DEFAULT_CHANNEL_ID,
  cdpUrl = DEFAULT_CDP_URL,
}) {
  const result = {
    success: false,
    project: projectRef,
    stage: null,
    error: null,
    title: null,
    videoPath: null,
    scheduledFor: null,
  };

  let browser;
  let page;

  try {
    // --- Validate inputs ---
    if (!projectRef) throw new Error("projectRef is required");
    if (!scheduleDate || Number.isNaN(new Date(scheduleDate).getTime())) {
      throw new Error("scheduleDate is required and must be a valid date");
    }
    if (new Date(scheduleDate) <= new Date()) {
      throw new Error("scheduleDate must be in the future");
    }
    scheduleDate = new Date(scheduleDate);

    // --- Load project (video + SEO metadata) ---
    result.stage = "load-project";
    const { videoPath, metadata } = loadProject(projectRef, projectsRoot);
    result.videoPath = videoPath;
    result.title = metadata.titles[0];
    result.stage = "connect-cdp";

    // --- Connect to Chrome via CDP, auto-launching if needed ---
    browser = await connectWithAutoLaunch(cdpUrl);
    page = (await browser.pages()).find((p) => p.url().includes(channelId));
    if (page) {
      result.stage = "reuse-studio-tab";
    } else {
      result.stage = "open-studio-tab";
      page = await browser.newPage();
    }
    await page.bringToFront();

    // --- Fresh load of the Studio dashboard ---
    // A reload clears stale hidden upload/date-picker elements that
    // accumulate across runs and can confuse the automation.
    result.stage = "fresh-load";
    await page.goto(`https://studio.youtube.com/channel/${channelId}`, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    console.log("Studio dashboard loaded");
    await new Promise((r) => setTimeout(r, 25000));

    // --- Resume if an upload dialog is already open (e.g. after a previous
    // run failed mid-way). Skip straight to the visibility navigation. ---
    const dialogOpen = await page.evaluate(() => {
      const dlg = document.querySelector("ytcp-uploads-dialog");
      return !!dlg && dlg.offsetParent !== null;
    });
    if (dialogOpen) {
      result.stage = "resume-open-dialog";
    } else {
      // --- Open Create -> Upload videos (retry until the menu opens) ---
      result.stage = "open-create-menu";
      let menuOpened = false;
      for (let attempt = 0; attempt < 5 && !menuOpened; attempt++) {
        await dismissOverlays(page);
        try {
          await activateByAriaLabel(page, "Create", 15000);
        } catch {
          /* retry */
        }
        await new Promise((r) => setTimeout(r, 1200));
        menuOpened = await page.evaluate(() =>
          [...document.querySelectorAll("tp-yt-paper-item")].some(
            (item) =>
              item.offsetParent !== null &&
              (item.getAttribute("test-id") || "") === "upload",
          ),
        );
      }
      if (!menuOpened)
        throw new Error("Could not open the Create menu (5 attempts)");

      result.stage = "select-upload";
      for (let attempt = 0; attempt < 3; attempt++) {
        await dismissOverlays(page);
        try {
          await activateMenuItem(page, "upload", 10000);
          break;
        } catch {
          if (attempt === 2) throw new Error('Could not click "Upload videos"');
        }
      }

      // --- Attach the video file ---
      result.stage = "attach-video";
      const fileInput = await page.waitForSelector('input[type="file"]', {
        timeout: 60000,
      });
      await fileInput.uploadFile(videoPath);

      // --- Wait for upload + details form ---
      result.stage = "wait-processing";
      await page.waitForFunction(
        () => {
          const dlg = document.querySelector("ytcp-uploads-dialog");
          if (!dlg) return false;
          return !!dlg.querySelector(
            "ytcp-social-suggestions-textbox#title-textarea",
          );
        },
        { timeout: 600000 },
      );
    }

    // --- Fill title ---
    if (!dialogOpen) {
      result.stage = "fill-title";
      const titleField = await page.waitForSelector(
        "ytcp-social-suggestions-textbox#title-textarea #textbox",
      );
      await titleField.click();
      await page.keyboard.down("Control");
      await page.keyboard.press("A");
      await page.keyboard.up("Control");
      await page.keyboard.press("Backspace");
      await titleField.type(metadata.titles[0], { delay: 10 });

      // --- Fill description ---
      result.stage = "fill-description";
      const descField = await page.waitForSelector(
        "ytcp-social-suggestions-textbox#description-textarea #textbox",
      );
      await descField.click();
      await page.keyboard.down("Control");
      await page.keyboard.press("A");
      await page.keyboard.up("Control");
      await page.keyboard.press("Backspace");
      await descField.type(metadata.description, { delay: 5 });

      // --- Fill tags (inside "Show advanced settings") ---
      result.stage = "fill-tags";
      await activateByAriaLabel(page, "Show advanced settings", 10000);
      const tagsField = await page.waitForSelector(
        '#tags-input, input[aria-label="Tags"]',
        { timeout: 15000 },
      );
      await tagsField.click();
      await tagsField.type(metadata.tags.join(", "), { delay: 5 });

      // --- Navigate to Visibility: Details -> Video elements -> Checks -> Visibility ---
      result.stage = "navigate-visibility";
      await clickNext(page);
      await clickNext(page);
      await clickNext(page);
    }

    // Wait for the Visibility screen. Prefer the schedule radio as the signal;
    // the old "Choose when to publish" copy check is stale on newer Studio.
    result.stage = "on-visibility";
    try {
      await page.waitForFunction(
        () => {
          const dlg = document.querySelector("ytcp-uploads-dialog");
          if (!dlg || dlg.offsetParent === null) return false;
          if (/choose when to publish|made for kids/i.test(dlg.innerText || ""))
            return true;
          return !!dlg.querySelector(
            "ytcp-video-visibility-select #second-container",
          );
        },
        { timeout: 15000 },
      );
    } catch {
      throw new Error(
        "Reached the Visibility screen but the form did not show",
      );
    }

    // --- Select the Schedule option so the date/time picker appears ---
    // The visibility selector is a custom component: #second-container is the
    // "Schedule" option; clicking it reveals the scheduler + datetime picker.
    result.stage = "select-schedule";
    await page.evaluate(() => {
      const c2 = document.querySelector(
        "ytcp-uploads-dialog ytcp-video-visibility-select #second-container",
      );
      if (!c2) return false;
      c2.click();
      return true;
    });
    await new Promise((r) => setTimeout(r, 1200));

    // --- Ensure the datetime picker is visible (expand if collapsed) ---
    result.stage = "expand-schedule";
    await page.evaluate(() => {
      const dlg = document.querySelector("ytcp-uploads-dialog");
      if (!dlg) return;
      const picker = dlg.querySelector("ytcp-datetime-picker");
      if (picker && picker.offsetParent !== null) return;
      const btn = [...dlg.querySelectorAll("button, ytcp-icon-button")].find(
        (b) =>
          (b.getAttribute("aria-label") || "").trim() === "Click to expand" &&
          b.offsetParent !== null,
      );
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 1200));

    // --- Set the schedule date and time ---
    // Date: open the calendar, set the "Enter date" paper-input (day-first
    // "2 Aug 2026"), Enter. Time: set the time paper-input directly.
    result.stage = "set-date";
    await typeScheduleDate(page, scheduleDate);
    result.stage = "set-time";
    await typeScheduleTime(page, scheduleDate);
    await new Promise((r) => setTimeout(r, 1500));

    result.scheduledFor = scheduleDate.toISOString();

    // --- Finalize: click Schedule ---
    result.stage = "schedule";
    await activateByAriaLabel(page, "Schedule", 15000);
    await new Promise((r) => setTimeout(r, 3000));

    // --- Confirm success ---
    // After scheduling, YouTube may keep the dialog open showing the success
    // panel, a "checking content" progress panel, or a "we're still checking
    // your content" warning — all of which still include the scheduled video
    // link (youtube.com/...). Presence of that link is the reliable success
    // signal; the dialog/button state alone is not.
    const confirmed = await page
      .waitForFunction(
        () => {
          const dlg = document.querySelector("ytcp-uploads-dialog");
          if (!dlg || dlg.offsetParent === null) return true;
          return [...dlg.querySelectorAll("a")].some(
            (a) =>
              /^https:\/\/youtube\.com\//.test(a.href || "") ||
              /^https:\/\/www\.youtube\.com\//.test(a.href || ""),
          );
        },
        { timeout: 15000 },
      )
      .then(() => true)
      .catch(() => false);
    if (!confirmed) throw new Error("Dialog did not confirm scheduling");

    // --- Clean up the post-schedule dialogs ---
    // YouTube sometimes stacks a "We're still checking your content" warning
    // on top of the success panel. Dismiss it via its "Got it" button, then
    // close the success dialog (its Schedule/done button closes it). This
    // leaves the browser clean for the next run.
    result.stage = "dismiss-warning";
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.evaluate(() => {
        const warn = [
          ...document.querySelectorAll("ytcp-dialog, tp-yt-paper-dialog"),
        ].find(
          (d) =>
            d.offsetParent !== null &&
            /still checking|come back/i.test(d.innerText || ""),
        );
        const btn = warn
          ? [...warn.querySelectorAll("button")].find(
              (b) =>
                b.offsetParent !== null && /got it/i.test(b.innerText || ""),
            )
          : null;
        if (btn) btn.click();
      });
      await new Promise((r) => setTimeout(r, 1200));
      const warnStill = await page.evaluate(() =>
        [...document.querySelectorAll("ytcp-dialog, tp-yt-paper-dialog")].some(
          (d) =>
            d.offsetParent !== null &&
            /still checking|come back/i.test(d.innerText || ""),
        ),
      );
      if (!warnStill) break;
    }

    result.stage = "close-dialog";
    await page.evaluate(() => {
      const dlg = document.querySelector("ytcp-uploads-dialog");
      if (!dlg || dlg.offsetParent === null) return;
      const btn = dlg.querySelector("#done-button button");
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 2000));
    // Final cleanup: reload clears any stuck dialog state (already-scheduled
    // videos keep the done button in a non-closing state).
    const stillOpen = await page.evaluate(() => {
      const dlg = document.querySelector("ytcp-uploads-dialog");
      return !!dlg && dlg.offsetParent !== null;
    });
    if (stillOpen) {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
      await new Promise((r) => setTimeout(r, 2500));
      await page.evaluate(() => {
        for (const d of [
          ...document.querySelectorAll("ytcp-dialog, tp-yt-paper-dialog"),
        ]) {
          if (d.offsetParent !== null && !(d.innerText || "").trim())
            d.remove();
        }
      });
    }

    result.success = true;
    result.stage = "done";
    result.error = null;
    return result;
  } catch (err) {
    result.success = false;
    result.error = err.message || String(err);
    return result;
  } finally {
    if (browser) await browser.disconnect().catch(() => {});
  }
}

// --- CLI wrapper ---
// Usage (flag form):   node bot/ytPost.js <project> --schedule "YYYY-MM-DD HH:MM"
// Usage (positional):  node bot/ytPost.js <project> "YYYY-MM-DDTHH:MM:SS.sssZ"   (server.js bridge)
const isMain = process.argv[1] && process.argv[1].endsWith("ytPost.js");
if (isMain) {
  const projectRef = process.argv[2];
  const scheduleIdx = process.argv.indexOf("--schedule");
  const scheduleRaw =
    scheduleIdx >= 0 ? process.argv[scheduleIdx + 1] : process.argv[3] || null;

  if (!projectRef || !scheduleRaw) {
    console.error(
      'Usage: node bot/ytPost.js <project-name> --schedule "YYYY-MM-DD HH:MM"',
    );
    console.error(
      '  e.g. node bot/ytPost.js p20 --schedule "2026-08-05 18:30"',
    );
    process.exit(1);
  }

  const result = await uploadProject({
    projectRef,
    scheduleDate: new Date(scheduleRaw),
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);
}
