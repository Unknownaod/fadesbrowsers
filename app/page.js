"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/*
 * =========================================================
 * FADES BROWSER  v0.3.0
 * =========================================================
 *
 * Tauri v2 + Next.js. Every native tab owns a real child
 * WebView that is kept alive (hidden) while you work in other
 * tabs, so pages keep their state like Chrome / Edge.
 *
 * Needs (see setup notes):
 *   - Rust command  `webview_eval`   (back/forward/reload/find/print)
 *   - capabilities  (window + webview permissions)
 *   - CSS           browser.css + search-tabs.css + browser-extras.css
 *
 * Optional: Rust can emit  "fades-tab-update"
 *   { label, url, title }  to keep tab titles / URLs in sync.
 */

/* ---------- Endpoints (edit to match your Express router) ---------- */

const FADES_LOGO = "/logo.png";
const FADES_SEARCH_API = "https://api.fades.lol/browser/search";
const FADES_SUGGEST_API = "https://api.fades.lol/browser/suggest";
const FADES_BROWSER_API = "https://api.fades.lol/browser";
const FADES_LOGIN_URL = "https://fades.lol/login";
const FADES_HOME_URL = "https://fades.lol";

const TOKEN_KEY = "fades-browser-token";
const SIGNIN_TIMEOUT_MS = 5 * 60 * 1000;
const FADES_AUTH_API = "https://api.fades.lol/auth";
const FADES_LOGIN_BASE = "https://fades.lol/login";

/* Cloud routes (relative to FADES_BROWSER_API) */
const SYNC_ROUTES = {
  session: "/session",
  pull: "/sync/pull",
  push: "/sync/push",
  wipe: "/data",
};

/* ---------- Constants ---------- */

const APP_VERSION = "0.3.0";
const NEW_TAB_URL = "fades://newtab";

const TABSTRIP_HEIGHT = 44;
const TOOLBAR_HEIGHT = 56;
const BOOKMARKS_HEIGHT = 40;
const FIND_BAR_HEIGHT = 44;
const SIDEBAR_WIDTH = 380;

const STORAGE = {
  settings: "fades-browser-settings",
  bookmarks: "fades-browser-bookmarks",
  history: "fades-browser-history",
  downloads: "fades-browser-downloads",
  shortcuts: "fades-browser-shortcuts",
  session: "fades-browser-session",
};

const DEFAULT_QUICK_LINKS = [
  { name: "YouTube", url: "https://www.youtube.com" },
  { name: "GitHub", url: "https://github.com" },
  { name: "Reddit", url: "https://www.reddit.com" },
  { name: "Fades", url: "https://fades.lol" },
];

const DEFAULT_SETTINGS = {
  theme: "dark",
  accent: "#8b7cff",
  engine: "fades",
  homepage: NEW_TAB_URL,
  startup: "newtab",
  showBookmarksBar: true,
  showHomeButton: true,
  showClock: true,
  showSiteIcons: true,
  searchSuggestions: true,
  safeSearch: true,
  autoSync: false,
  defaultZoom: 1,
};

const SEARCH_ENGINES = {
  fades: { name: "Fades", url: null },
  google: { name: "Google", url: "https://www.google.com/search?q=%s" },
  bing: { name: "Bing", url: "https://www.bing.com/search?q=%s" },
  duckduckgo: { name: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s" },
  brave: { name: "Brave", url: "https://search.brave.com/search?q=%s" },
};

const ACCENTS = [
  "#8b7cff",
  "#5ec8ff",
  "#3ddc97",
  "#ffb84d",
  "#ff6ad5",
  "#ff5c6c",
];

const ZOOM_STEPS = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3,
  4, 5,
];

const SEARCH_TABS = [
  { id: "all", label: "All", icon: "⌕" },
  { id: "images", label: "Images", icon: "▣" },
  { id: "videos", label: "Videos", icon: "▶" },
  { id: "news", label: "News", icon: "☰" },
  { id: "shopping", label: "Shopping", icon: "◈" },
];

const TIME_FILTERS = [
  { id: "any", label: "Any time" },
  { id: "day", label: "Past 24 hours" },
  { id: "week", label: "Past week" },
  { id: "month", label: "Past month" },
  { id: "year", label: "Past year" },
];

const TYPE_NOUN = {
  all: "results",
  images: "images",
  videos: "videos",
  news: "articles",
  shopping: "products",
};

const KEYBOARD_SHORTCUTS = [
  ["New tab", "Ctrl+T"],
  ["New private tab", "Ctrl+Shift+N"],
  ["Reopen closed tab", "Ctrl+Shift+T"],
  ["Close tab", "Ctrl+W"],
  ["Next / previous tab", "Ctrl+Tab / Ctrl+Shift+Tab"],
  ["Jump to tab 1-8 / last", "Ctrl+1…8 / Ctrl+9"],
  ["Focus address bar", "Ctrl+L / F6"],
  ["Back / Forward", "Alt+← / Alt+→"],
  ["Home", "Alt+Home"],
  ["Reload", "Ctrl+R / F5"],
  ["Bookmark this page", "Ctrl+D"],
  ["Show / hide bookmarks bar", "Ctrl+Shift+B"],
  ["History", "Ctrl+H"],
  ["Downloads", "Ctrl+J"],
  ["Find in page", "Ctrl+F"],
  ["Zoom in / out / reset", "Ctrl++ / Ctrl+- / Ctrl+0"],
  ["Print", "Ctrl+P"],
  ["Full screen", "F11"],
  ["Settings", "Ctrl+,"],
  ["Close panel / find / menu", "Esc"],
];

/*
 * =========================================================
 * SMALL HELPERS
 * =========================================================
 */

function Icon({ children, className = "" }) {
  return (
    <span className={`icon ${className}`} aria-hidden="true">
      {children}
    </span>
  );
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hexToRgb(hex) {
  const clean = String(hex).replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const value = parseInt(full, 16);

  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function downloadJson(filename, data) {
  try {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const link = document.createElement("a");

    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(link.href), 1500);
  } catch (error) {
    console.error("[Fades Browser] Export failed:", error);
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function getGreeting() {
  const hour = new Date().getHours();

  if (hour < 5) return "Still up?";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";

  return "Good evening";
}

function dayLabel(iso) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();

  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";

  return date.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function pick(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return "";
}

function toText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return String(value.name || value.title || "");

  return String(value);
}


function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

function makeLinkCode() {
  const bytes = new Uint8Array(16);

  crypto.getRandomValues(bytes);

  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function formatUserCode(code) {
  const text = code.slice(0, 8).toUpperCase();

  return `${text.slice(0, 4)}-${text.slice(4)}`;
}

/*
 * =========================================================
 * URL HELPERS
 * =========================================================
 */

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

function isExplicitUrl(value) {
  const input = String(value || "").trim();

  if (!input || /\s/.test(input)) return false;
  if (SCHEME_RE.test(input) || input.startsWith("about:")) return true;
  if (/^localhost(:\d+)?([/?#].*)?$/i.test(input)) return true;
  if (/^(\d{1,3}\.){3}\d{1,3}(:\d+)?([/?#].*)?$/.test(input)) return true;
  if (/^[^\s/?#]+\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(input)) return true;

  return false;
}

function isFadesSearchUrl(url) {
  return typeof url === "string" && url.startsWith("fades://search");
}

function isNativeUrl(url) {
  return Boolean(url) && url !== NEW_TAB_URL && !String(url).startsWith("fades://");
}

function isNativeTab(tab) {
  return Boolean(tab && isNativeUrl(tab.url));
}

function getSearchParam(url, name) {
  if (!isFadesSearchUrl(url)) return "";

  try {
    return new URL(url).searchParams.get(name) || "";
  } catch {
    const match = String(url).match(new RegExp(`[?&]${name}=([^&]+)`));

    if (!match) return "";

    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
}

function getSearchQueryFromUrl(url) {
  return getSearchParam(url, "q");
}

function getSearchTypeFromUrl(url) {
  const type = getSearchParam(url, "type");

  return SEARCH_TABS.some((tab) => tab.id === type) ? type : "all";
}

function getSearchTimeFromUrl(url) {
  const time = getSearchParam(url, "time");

  return TIME_FILTERS.some((item) => item.id === time) ? time : "any";
}

function getSearchReloadFromUrl(url) {
  return getSearchParam(url, "reload");
}

function buildSearchUrl(query, { type = "all", time = "any", reload = "" } = {}) {
  let url = `fades://search?q=${encodeURIComponent(query)}`;

  if (type && type !== "all") url += `&type=${encodeURIComponent(type)}`;
  if (time && time !== "any") url += `&time=${encodeURIComponent(time)}`;
  if (reload) url += `&reload=${reload}`;

  return url;
}

function getNavigationUrl(value, engine = "fades") {
  const input = String(value || "").trim();

  if (!input) return NEW_TAB_URL;
  if (input.startsWith("fades://")) return input;

  if (isExplicitUrl(input)) {
    if (SCHEME_RE.test(input) || input.startsWith("about:")) return input;

    if (
      /^localhost(:\d+)?/i.test(input) ||
      /^(\d{1,3}\.){3}\d{1,3}(:\d+)?/.test(input)
    ) {
      return `http://${input}`;
    }

    return `https://${input}`;
  }

  const config = SEARCH_ENGINES[engine] || SEARCH_ENGINES.fades;

  if (!config.url) return buildSearchUrl(input);

  return config.url.replace("%s", encodeURIComponent(input));
}

function getHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function getTitleFromUrl(url) {
  if (!url || url === NEW_TAB_URL) return "New Tab";

  if (isFadesSearchUrl(url)) {
    const query = getSearchQueryFromUrl(url);

    return query ? `${query} - Fades Search` : "Fades Search";
  }

  if (String(url).startsWith("fades://")) return "Fades Browser";

  const host = getHost(url).split(".")[0];

  if (!host) return "Fades Browser";

  return host.replace(/^\w/, (letter) => letter.toUpperCase());
}

function formatDisplayUrl(value) {
  if (!value) return "";

  try {
    const url = new URL(value);

    return `${url.hostname.replace(/^www\./, "")}${
      url.pathname === "/" ? "" : url.pathname
    }`;
  } catch {
    return String(value).replace(/^https?:\/\//, "").replace(/^www\./, "");
  }
}

function faviconUrl(url) {
  try {
    const parsed = new URL(url);

    if (!/^https?:$/.test(parsed.protocol)) return "";

    return `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=64`;
  } catch {
    return "";
  }
}

function SiteIcon({ url, className = "", fallback = "◉" }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [url]);

  const src = faviconUrl(url);

  if (!src || failed) {
    return <span className={`site-icon-fallback ${className}`}>{fallback}</span>;
  }

  return (
    <img
      className={`site-icon ${className}`}
      src={src}
      alt=""
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

/*
 * =========================================================
 * TAB HELPERS
 * =========================================================
 */

let tabCounter = 0;

function createTabId() {
  tabCounter += 1;

  return Date.now() * 1000 + (tabCounter % 1000);
}

function getWebviewLabel(tabId) {
  return `fades-browser-tab-${tabId}`;
}

function getTabIdFromLabel(label) {
  const match = String(label || "").match(/^fades-browser-tab-(\d+)$/);

  return match ? Number(match[1]) : null;
}

function makeTab(url = NEW_TAB_URL, options = {}) {
  return {
    id: createTabId(),
    title: options.title || getTitleFromUrl(url),
    url,
    currentUrl: "",
    private: Boolean(options.private),
    pinned: Boolean(options.pinned),
    zoom: options.zoom || 1,
    navKey: 0,
    loading: isNativeUrl(url),
    backStack: [],
    forwardStack: [],
  };
}

/*
 * =========================================================
 * TAURI BRIDGE
 * =========================================================
 */

function hasTauri() {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

async function getTauriWebview() {
  if (!hasTauri()) return null;

  try {
    const { Webview } = await import("@tauri-apps/api/webview");

    return Webview;
  } catch (error) {
    console.error("[Fades Browser] Could not load Webview API:", error);

    return null;
  }
}

async function getTauriWindow() {
  if (!hasTauri()) return null;

  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");

    return getCurrentWindow();
  } catch (error) {
    console.error("[Fades Browser] Could not load Window API:", error);

    return null;
  }
}

async function tauriInvoke(command, args) {
  if (!hasTauri()) return { ok: false };

  try {
    const { invoke } = await import("@tauri-apps/api/core");

    return { ok: true, value: await invoke(command, args) };
  } catch (error) {
    return { ok: false, error };
  }
}

async function listenTauri(event, handler) {
  if (!hasTauri()) return () => {};

  try {
    const { listen } = await import("@tauri-apps/api/event");

    return await listen(event, handler);
  } catch {
    return () => {};
  }
}

async function evalInTab(tabId, script) {
  const result = await tauriInvoke("webview_eval", {
    label: getWebviewLabel(tabId),
    script,
  });

  if (result.ok) return true;

  try {
    const Webview = await getTauriWebview();
    const webview = Webview
      ? await Webview.getByLabel(getWebviewLabel(tabId))
      : null;

    if (webview && typeof webview.eval === "function") {
      await webview.eval(script);

      return true;
    }
  } catch {}

  return false;
}

async function positionTabWebview(webview, { top, right }) {
  if (!webview) return;

  try {
    const { LogicalPosition, LogicalSize } = await import(
      "@tauri-apps/api/dpi"
    );

    await webview.setPosition(new LogicalPosition(0, top));
    await webview.setSize(
      new LogicalSize(
        Math.max(320, window.innerWidth - right),
        Math.max(250, window.innerHeight - top)
      )
    );
  } catch (error) {
    console.error("[Fades Browser] Failed to size WebView:", error);
  }
}

async function minimizeWindow() {
  try {
    await (await getTauriWindow())?.minimize();
  } catch (error) {
    console.error("[Fades Browser] Minimize failed:", error);
  }
}

async function toggleMaximizeWindow() {
  try {
    await (await getTauriWindow())?.toggleMaximize();
  } catch (error) {
    console.error("[Fades Browser] Maximize failed:", error);
  }
}

async function closeWindow() {
  try {
    await (await getTauriWindow())?.close();
  } catch (error) {
    console.error("[Fades Browser] Close failed:", error);
  }
}

async function startWindowDrag() {
  try {
    await (await getTauriWindow())?.startDragging();
  } catch (error) {
    console.error("[Fades Browser] Window dragging failed:", error);
  }
}

async function request(base, path, options = {}) {
  const token = getToken();

  const response = await fetch(`${base}${path}`, {
    ...options,
    credentials: "omit",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const error = new Error(`Request failed (${response.status})`);

    error.status = response.status;

    throw error;
  }

  if (response.status === 204) return null;

  return response.json().catch(() => null);
}

const apiFetch = (path, options) => request(FADES_BROWSER_API, path, options);
const authFetch = (path, options) => request(FADES_AUTH_API, path, options);

async function openDownloadedFile(path) {
  try {
    const { openPath } = await import("@tauri-apps/plugin-opener");
    await openPath(path);
    return true;
  } catch {
    return false;
  }
}

async function revealDownloadedFile(path) {
  try {
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    await revealItemInDir(path);
    return true;
  } catch {
    return false;
  }
}

async function checkForUpdate() {
  if (!hasTauri()) return null;

  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    return await check();
  } catch (error) {
    console.error("[Fades Browser] Update check failed:", error);
    return null;
  }
}

async function installUpdate(update) {
  await update.downloadAndInstall();
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

/*
 * =========================================================
 * SEARCH RESULT NORMALIZING
 * =========================================================
 */

function formatResultDate(value) {
  const text = toText(value);

  if (!text) return "";

  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const date = new Date(text);

    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString([], { dateStyle: "medium" });
    }
  }

  return text;
}

function formatDuration(value) {
  if (value === "" || value === undefined || value === null) return "";

  if (typeof value === "number" || /^\d+$/.test(String(value))) {
    const total = Number(value);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = String(total % 60).padStart(2, "0");

    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
      : `${minutes}:${seconds}`;
  }

  return String(value);
}

function formatViews(value) {
  if (value === "" || value === undefined || value === null) return "";

  const number = Number(value);

  if (Number.isNaN(number)) return String(value);

  return `${new Intl.NumberFormat([], { notation: "compact" }).format(
    number
  )} views`;
}

function normalizeSearchResult(result, type) {
  const image = toText(
    pick(result.image, result.imageUrl, result.image_url, result.original, result.src)
  );

  const thumbnail = toText(
    pick(
      result.thumbnail,
      result.thumbnailUrl,
      result.thumbnail_url,
      result.thumb,
      result.preview,
      image
    )
  );

  const url = toText(
    pick(
      result.url,
      result.link,
      result.href,
      result.pageUrl,
      result.page_url,
      result.sourceUrl,
      result.contextLink
    )
  );

  return {
    title: toText(pick(result.title, result.name, "Untitled result")),
    url: url || (type === "images" ? image : ""),
    description: toText(pick(result.description, result.snippet, result.text)),
    displayUrl: toText(pick(result.displayUrl, result.display_url, url)),
    favicon: toText(pick(result.favicon, result.icon)),
    image,
    thumbnail,
    source: toText(
      pick(
        result.source,
        result.publisher,
        result.channel,
        result.uploader,
        result.author,
        result.store,
        result.site
      )
    ),
    date: formatResultDate(
      pick(
        result.date,
        result.published,
        result.publishedAt,
        result.published_at,
        result.age
      )
    ),
    duration: formatDuration(pick(result.duration, result.length)),
    views: formatViews(pick(result.views, result.viewCount, result.view_count)),
    price: toText(result.price),
  };
}

function extractIncoming(data, type) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];

  for (const key of ["results", "items", type, "images", "videos", "news", "shopping"]) {
    if (Array.isArray(data[key])) return data[key];
  }

  return [];
}

/*
 * =========================================================
 * MAIN COMPONENT
 * =========================================================
 */

export default function Home() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [tabs, setTabs] = useState(() => [makeTab()]);
  const [activeTab, setActiveTab] = useState(null);
  const [activated, setActivated] = useState([]);

  const [address, setAddress] = useState("");
  const [addressDirty, setAddressDirty] = useState(false);
  const [omniFocused, setOmniFocused] = useState(false);
  const [omniIndex, setOmniIndex] = useState(-1);
  const [remoteSuggestions, setRemoteSuggestions] = useState([]);

  const [bookmarks, setBookmarks] = useState([]);
  const [history, setHistory] = useState([]);
  const [downloads, setDownloads] = useState([]);
  const [shortcuts, setShortcuts] = useState(DEFAULT_QUICK_LINKS);
  const [closedTabs, setClosedTabs] = useState([]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarPage, setSidebarPage] = useState("menu");

  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState("");

  const [tabMenu, setTabMenu] = useState(null);
  const [toast, setToast] = useState(null);
  const [clock, setClock] = useState("");
  const [isMaximized, setIsMaximized] = useState(false);
  const [browserReady, setBrowserReady] = useState(false);

  const [account, setAccount] = useState({
    status: "unknown",
    user: null,
    syncing: false,
    message: "",
    lastSync: "",
  });

  const [pendingSignIn, setPendingSignIn] = useState(null);
  const addressRef = useRef(null);
  const findRef = useRef(null);
  const suggestFailures = useRef(0);
  const [downloadFlyout, setDownloadFlyout] = useState(false);
  const flyoutTimer = useRef(null);

  /* ---------- live refs (so callbacks never go stale) ---------- */

  const currentTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTab) || tabs[0],
    [tabs, activeTab]
  );

  const tabsRef = useRef(tabs);
  const currentTabRef = useRef(currentTab);
  const settingsRef = useRef(settings);
  const bookmarksRef = useRef(bookmarks);
  const closedTabsRef = useRef(closedTabs);
  const dataRef = useRef({});

  tabsRef.current = tabs;
  currentTabRef.current = currentTab;
  settingsRef.current = settings;
  bookmarksRef.current = bookmarks;
  closedTabsRef.current = closedTabs;
  dataRef.current = { bookmarks, history, shortcuts, settings, tabs };

  const currentUrl = currentTab ? currentTab.currentUrl || currentTab.url : "";
  const isBookmarked = Boolean(
    currentTab && bookmarks.some((bookmark) => bookmark.url === currentUrl)
  );

  /* ---------- toast ---------- */

  const notify = useCallback((message) => {
    const id = Date.now();

    setToast({ id, message });

    setTimeout(
      () => setToast((current) => (current && current.id === id ? null : current)),
      2400
    );
  }, []);

  /* =======================================================
   * STARTUP: restore data + session
   * ======================================================= */

  useEffect(() => {
    const stored = { ...DEFAULT_SETTINGS, ...loadJson(STORAGE.settings, {}) };

    setSettings(stored);
    setBookmarks(loadJson(STORAGE.bookmarks, []));
    setHistory(loadJson(STORAGE.history, []));
    setDownloads(loadJson(STORAGE.downloads, []));
    setShortcuts(loadJson(STORAGE.shortcuts, null) || DEFAULT_QUICK_LINKS);

    if (stored.startup === "restore") {
      const session = loadJson(STORAGE.session, null);

      if (session && Array.isArray(session.tabs) && session.tabs.length > 0) {
        const restored = session.tabs.map((item) =>
          makeTab(item.url, {
            title: item.title,
            pinned: item.pinned,
            zoom: item.zoom,
          })
        );

        setTabs(restored);
        setActiveTab(restored[clamp(session.active || 0, 0, restored.length - 1)].id);
      }
    } else if (
      stored.startup === "homepage" &&
      stored.homepage &&
      stored.homepage !== NEW_TAB_URL
    ) {
      setTabs([makeTab(getNavigationUrl(stored.homepage, stored.engine))]);
    }

    setBrowserReady(true);
  }, []);

  useEffect(() => {
    if (browserReady) saveJson(STORAGE.settings, settings);
  }, [settings, browserReady]);

  useEffect(() => {
    if (browserReady) saveJson(STORAGE.bookmarks, bookmarks);
  }, [bookmarks, browserReady]);

  useEffect(() => {
    if (browserReady) saveJson(STORAGE.history, history);
  }, [history, browserReady]);

  useEffect(() => {
    if (browserReady) saveJson(STORAGE.downloads, downloads);
  }, [downloads, browserReady]);

  useEffect(() => {
    if (browserReady) saveJson(STORAGE.shortcuts, shortcuts);
  }, [shortcuts, browserReady]);

  useEffect(() => {
    if (!browserReady) return;

    const open = tabs.filter((tab) => !tab.private && !tab.url.startsWith(FADES_LOGIN_BASE));

    saveJson(STORAGE.session, {
      tabs: open.map((tab) => ({
        url: tab.url,
        title: tab.title,
        pinned: tab.pinned,
        zoom: tab.zoom,
      })),
      active: Math.max(0, open.findIndex((tab) => tab.id === activeTab)),
    });
  }, [tabs, activeTab, browserReady]);


useEffect(() => {
  if (!browserReady) return;

  let cancelled = false;

  (async () => {
    const update = await checkForUpdate();

    if (cancelled || !update) return;

    if (window.confirm(`Fades Browser ${update.version} is available. Update now?`)) {
      notify("Downloading update…");
      try {
        await installUpdate(update);
      } catch {
        notify("Update failed");
      }
    }
  })();

  return () => {
    cancelled = true;
  };
}, [browserReady, notify]);
  /* ---------- theme + accent ---------- */

  useEffect(() => {
    const root = document.documentElement;
    const { r, g, b } = hexToRgb(settings.accent);
    const theme =
      settings.theme === "system"
        ? window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark"
        : settings.theme;

    root.dataset.theme = theme;
    root.style.setProperty("--accent", settings.accent);
    root.style.setProperty("--accent-soft", `rgba(${r}, ${g}, ${b}, 0.16)`);
    root.style.setProperty("--accent-glow", `rgba(${r}, ${g}, ${b}, 0.35)`);
  }, [settings.theme, settings.accent]);

  /* ---------- header height + sidebar width as CSS variables ---------- */

  const topOffset =
    TABSTRIP_HEIGHT +
    TOOLBAR_HEIGHT +
    (settings.showBookmarksBar ? BOOKMARKS_HEIGHT : 0) +
    (findOpen ? FIND_BAR_HEIGHT : 0);

  const rightInset = sidebarOpen ? SIDEBAR_WIDTH : 0;

  useEffect(() => {
    const root = document.documentElement;

    root.style.setProperty("--header-h", `${topOffset}px`);
    root.style.setProperty("--sidebar-w", `${rightInset}px`);
  }, [topOffset, rightInset]);

  /* ---------- keep the active tab "activated" (lazy webviews) ---------- */

  useEffect(() => {
    if (!currentTab) return;

    if (activeTab !== currentTab.id) setActiveTab(currentTab.id);

    setActivated((items) =>
      items.includes(currentTab.id) ? items : [...items, currentTab.id]
    );
  }, [currentTab?.id, activeTab]);

  /* ---------- clock ---------- */

  useEffect(() => {
    const update = () =>
      setClock(
        new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      );

    update();

    const timer = setInterval(update, 1000);

    return () => clearInterval(timer);
  }, []);

  /* ---------- maximized state ---------- */

  useEffect(() => {
    let timer = null;
    let cancelled = false;

    const check = async () => {
      const appWindow = await getTauriWindow();

      if (!appWindow || cancelled) return;

      try {
        const value = await appWindow.isMaximized();

        if (!cancelled) setIsMaximized(value);
      } catch {}
    };

    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(check, 150);
    };

    check();
    window.addEventListener("resize", onResize);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  /* =======================================================
   * HISTORY
   * ======================================================= */

  const recordHistory = useCallback((url, title, isPrivate) => {
    if (isPrivate || !url || url === NEW_TAB_URL) return;
    if (String(url).startsWith("fades://") && !isFadesSearchUrl(url)) return;

    const cleanUrl = url.replace(/&reload=\d+/, "");

    setHistory((items) => {
      const existing = items.find((item) => item.url === cleanUrl);

      return [
        {
          title: title || getTitleFromUrl(cleanUrl),
          url: cleanUrl,
          visitedAt: new Date().toISOString(),
          visits: (existing?.visits || 0) + 1,
        },
        ...items.filter((item) => item.url !== cleanUrl),
      ].slice(0, 500);
    });
  }, []);

  /* =======================================================
   * SIDEBAR
   * ======================================================= */

  const openSidebar = useCallback((page) => {
    setSidebarPage(page);
    setSidebarOpen(true);
  }, []);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  const showDownloadFlyout = useCallback((autoHideMs = 0) => {
  clearTimeout(flyoutTimer.current);
  setDownloadFlyout(true);

  if (autoHideMs) {
    flyoutTimer.current = setTimeout(() => setDownloadFlyout(false), autoHideMs);
  }
}, []);

const hideDownloadFlyout = useCallback(() => {
  clearTimeout(flyoutTimer.current);
  setDownloadFlyout(false);
}, []);

  /* =======================================================
   * TABS
   * ======================================================= */

  const updateTab = useCallback((id, patch) => {
    setTabs((items) =>
      items.map((tab) =>
        tab.id === id
          ? { ...tab, ...(typeof patch === "function" ? patch(tab) : patch) }
          : tab
      )
    );
  }, []);

  const openTab = useCallback(
    (
      url = NEW_TAB_URL,
      { activate = true, isPrivate = false, position = "end", afterId, title } = {}
    ) => {
      const tab = makeTab(url, {
        private: isPrivate,
        zoom: settingsRef.current.defaultZoom,
        title,
      });

      setTabs((items) => {
        const next = [...items];

        if (position === "after") {
          const anchor = afterId ?? currentTabRef.current?.id;
          const index = next.findIndex((item) => item.id === anchor);

          next.splice(index >= 0 ? index + 1 : next.length, 0, tab);
        } else {
          next.push(tab);
        }

        return next;
      });

      if (activate) setActiveTab(tab.id);

      recordHistory(url, title, isPrivate);

      return tab.id;
    },
    [recordHistory]
  );

  const closeTab = useCallback((id, event) => {
    event?.stopPropagation?.();

    const list = tabsRef.current;
    const tab = list.find((item) => item.id === id);

    if (!tab) return;

       if (!tab.private && tab.url !== NEW_TAB_URL && !tab.url.startsWith(FADES_LOGIN_BASE)) {      setClosedTabs((items) =>
        [
          { title: tab.title, url: tab.url, closedAt: Date.now() },
          ...items,
        ].slice(0, 15)
      );
    }

    if (list.length === 1) {
      const fresh = makeTab();

      setTabs([fresh]);
      setActiveTab(fresh.id);

      return;
    }

    const index = list.findIndex((item) => item.id === id);
    const remaining = list.filter((item) => item.id !== id);

    setTabs(remaining);

    if (id === currentTabRef.current?.id) {
      const next = remaining[index] || remaining[index - 1] || remaining[0];

      setActiveTab(next.id);
    }
  }, []);

  const closeOtherTabs = useCallback((id) => {
    const keep = tabsRef.current.filter((tab) => tab.id === id);

    if (keep.length === 0) return;

    setTabs(keep);
    setActiveTab(id);
  }, []);

  const closeTabsToRight = useCallback((id) => {
    const list = tabsRef.current;
    const index = list.findIndex((tab) => tab.id === id);

    if (index < 0) return;

    const remaining = list.slice(0, index + 1);

    setTabs(remaining);

    if (!remaining.some((tab) => tab.id === currentTabRef.current?.id)) {
      setActiveTab(id);
    }
  }, []);

  const reopenClosedTab = useCallback((index = 0) => {
    const item = closedTabsRef.current[index];

    if (!item) {
      notify("No recently closed tabs");

      return;
    }

    setClosedTabs((items) => items.filter((_, i) => i !== index));
    openTab(item.url, { title: item.title });
  }, [notify, openTab]);

  const duplicateTab = useCallback(
    (id) => {
      const source = tabsRef.current.find((tab) => tab.id === (id ?? currentTabRef.current?.id));

      if (!source) return;

      const copy = {
        ...makeTab(source.url, {
          private: source.private,
          pinned: false,
          zoom: source.zoom,
          title: source.title,
        }),
      };

      setTabs((items) => {
        const next = [...items];
        const index = next.findIndex((tab) => tab.id === source.id);

        next.splice(index + 1, 0, copy);

        return next;
      });

      setActiveTab(copy.id);
    },
    []
  );

  const togglePinTab = useCallback((id) => {
    setTabs((items) => {
      const toggled = items.map((tab) =>
        tab.id === id ? { ...tab, pinned: !tab.pinned } : tab
      );

      return [...toggled.filter((tab) => tab.pinned), ...toggled.filter((tab) => !tab.pinned)];
    });
  }, []);

  const moveTab = useCallback((id, direction) => {
    setTabs((items) => {
      const index = items.findIndex((tab) => tab.id === id);
      const target = index + direction;

      if (index < 0 || target < 0 || target >= items.length) return items;
      if (items[index].pinned !== items[target].pinned) return items;

      const next = [...items];

      [next[index], next[target]] = [next[target], next[index]];

      return next;
    });
  }, []);

  const switchTab = useCallback((id) => {
    setActiveTab(id);
    setTabMenu(null);
  }, []);

  const cycleTab = useCallback((direction) => {
    const list = tabsRef.current;
    const index = list.findIndex((tab) => tab.id === currentTabRef.current?.id);

    if (list.length < 2 || index < 0) return;

    setActiveTab(list[(index + direction + list.length) % list.length].id);
  }, []);

  const jumpToTab = useCallback((number) => {
    const list = tabsRef.current;
    const target = number === 9 ? list[list.length - 1] : list[number - 1];

    if (target) setActiveTab(target.id);
  }, []);

  /* =======================================================
   * NAVIGATION
   * ======================================================= */

  const commitNavigation = useCallback(
    (tabId, url, { push = true } = {}) => {
      const title = getTitleFromUrl(url);
      const tab = tabsRef.current.find((item) => item.id === tabId);

      setTabs((items) =>
        items.map((item) => {
          if (item.id !== tabId) return item;

          return {
            ...item,
            url,
            title,
            currentUrl: "",
            navKey: item.navKey + 1,
            loading: isNativeUrl(url),
            backStack:
              push && item.url !== url
                ? [...item.backStack.slice(-49), { url: item.url, title: item.title }]
                : item.backStack,
            forwardStack: push ? [] : item.forwardStack,
          };
        })
      );

      if (tab) recordHistory(url, title, tab.private);

      setAddressDirty(false);
    },
    [recordHistory]
  );

  const navigate = useCallback(
    (raw, options = {}) => {
      const value = typeof raw === "string" ? raw : "";
      const url = getNavigationUrl(value, settingsRef.current.engine);

      if (url.startsWith("fades://settings")) {
        openSidebar("settings");

        return;
      }

      if (options.newTab) {
        openTab(url, {
          activate: options.activate !== false,
          position: "after",
        });

        return;
      }

      const tab = currentTabRef.current;

      if (!tab) return;

      commitNavigation(tab.id, url);
    },
    [commitNavigation, openSidebar, openTab]
  );

  const navigateToResult = useCallback(
    (url, title, options = {}) => {
      if (!url) return;

      const target = SCHEME_RE.test(url) ? url : getNavigationUrl(url);

      if (options.newTab) {
        openTab(target, { activate: false, position: "after", title });
        notify("Opened in a new tab");

        return;
      }

      const tab = currentTabRef.current;

      if (!tab) return;

      commitNavigation(tab.id, target);
    },
    [commitNavigation, notify, openTab]
  );

  const searchFromPage = useCallback(
    (value, { type = "all", time = "any" } = {}) => {
      const clean = String(value || "").trim();

      if (!clean) return;

      const target = getNavigationUrl(clean, "fades");

      if (!isFadesSearchUrl(target)) {
        navigate(clean);

        return;
      }

      const tab = currentTabRef.current;

      if (tab) commitNavigation(tab.id, buildSearchUrl(clean, { type, time }));
    },
    [commitNavigation, navigate]
  );

  const goBack = useCallback(async () => {
    const tab = currentTabRef.current;

    if (!tab) return;

    if (tab.backStack.length > 0) {
      const previous = tab.backStack[tab.backStack.length - 1];

      updateTab(tab.id, (item) => ({
        url: previous.url,
        title: previous.title,
        currentUrl: "",
        navKey: item.navKey + 1,
        loading: isNativeUrl(previous.url),
        backStack: item.backStack.slice(0, -1),
        forwardStack: [{ url: item.url, title: item.title }, ...item.forwardStack].slice(0, 50),
      }));

      return;
    }

    if (isNativeTab(tab)) {
      const ok = await evalInTab(tab.id, "history.back();");

      if (!ok) notify("Back needs the webview_eval Rust command (see setup notes)");
    }
  }, [notify, updateTab]);

  const goForward = useCallback(async () => {
    const tab = currentTabRef.current;

    if (!tab) return;

    if (tab.forwardStack.length > 0) {
      const next = tab.forwardStack[0];

      updateTab(tab.id, (item) => ({
        url: next.url,
        title: next.title,
        currentUrl: "",
        navKey: item.navKey + 1,
        loading: isNativeUrl(next.url),
        forwardStack: item.forwardStack.slice(1),
        backStack: [...item.backStack, { url: item.url, title: item.title }].slice(-50),
      }));

      return;
    }

    if (isNativeTab(tab)) {
      const ok = await evalInTab(tab.id, "history.forward();");

      if (!ok) notify("Forward needs the webview_eval Rust command (see setup notes)");
    }
  }, [notify, updateTab]);

  const reloadPage = useCallback(
    async (id) => {
      const tab = tabsRef.current.find((item) => item.id === (id ?? currentTabRef.current?.id));

      if (!tab || tab.url === NEW_TAB_URL) return;

      if (isFadesSearchUrl(tab.url)) {
        updateTab(tab.id, {
          url: buildSearchUrl(getSearchQueryFromUrl(tab.url), {
            type: getSearchTypeFromUrl(tab.url),
            time: getSearchTimeFromUrl(tab.url),
            reload: Date.now(),
          }),
        });

        return;
      }

      if (!isNativeTab(tab)) return;

      const ok = await evalInTab(tab.id, "location.reload();");

      if (ok) {
        updateTab(tab.id, { loading: true });
        setTimeout(() => updateTab(tab.id, { loading: false }), 900);
      } else {
        updateTab(tab.id, (item) => ({ navKey: item.navKey + 1, loading: true }));
      }
    },
    [updateTab]
  );

  const goHome = useCallback(() => {
    navigate(settingsRef.current.homepage || NEW_TAB_URL);
  }, [navigate]);

  /* =======================================================
   * PAGE TOOLS: find, zoom, print, fullscreen, copy
   * ======================================================= */

  const runFind = useCallback((text, backwards = false) => {
    const tab = currentTabRef.current;

    if (!text || !tab) return;

    if (isNativeTab(tab)) {
      evalInTab(
        tab.id,
        `window.find(${JSON.stringify(text)}, false, ${backwards}, true, false, false, false);`
      );
    } else if (typeof window.find === "function") {
      window.find(text, false, backwards, true, false, false, false);
    }
  }, []);

  const openFind = useCallback(() => {
    setFindOpen(true);
    setTimeout(() => {
      findRef.current?.focus();
      findRef.current?.select();
    }, 30);
  }, []);

  const closeFind = useCallback(() => {
    setFindOpen(false);

    const tab = currentTabRef.current;

    if (tab && isNativeTab(tab)) {
      evalInTab(tab.id, "window.getSelection().removeAllRanges();");
    }
  }, []);

  const changeZoom = useCallback(
    (direction) => {
      const tab = currentTabRef.current;

      if (!tab) return;

      let next = 1;

      if (direction !== "reset") {
        let nearest = 0;

        ZOOM_STEPS.forEach((step, index) => {
          if (Math.abs(step - tab.zoom) < Math.abs(ZOOM_STEPS[nearest] - tab.zoom)) {
            nearest = index;
          }
        });

        next = ZOOM_STEPS[clamp(nearest + direction, 0, ZOOM_STEPS.length - 1)];
      }

      updateTab(tab.id, { zoom: next });
      notify(`Zoom ${Math.round(next * 100)}%`);
    },
    [notify, updateTab]
  );

  const printPage = useCallback(() => {
    const tab = currentTabRef.current;

    if (tab && isNativeTab(tab)) evalInTab(tab.id, "window.print();");
    else window.print();
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      const appWindow = await getTauriWindow();

      if (!appWindow) return;

      await appWindow.setFullscreen(!(await appWindow.isFullscreen()));
    } catch (error) {
      console.error("[Fades Browser] Fullscreen failed:", error);
    }
  }, []);

  const copyLink = useCallback(async () => {
    const tab = currentTabRef.current;

    if (!tab) return;

    const url = isFadesSearchUrl(tab.url)
      ? getSearchQueryFromUrl(tab.url)
      : tab.currentUrl || tab.url;

    notify((await copyText(url)) ? "Link copied" : "Could not copy link");
  }, [notify]);

  /* =======================================================
   * BOOKMARKS / SHORTCUTS / SETTINGS / DATA
   * ======================================================= */

  const toggleBookmark = useCallback(() => {
    const tab = currentTabRef.current;

    if (!tab || !isNativeTab(tab)) {
      notify("Open a website to bookmark it");

      return;
    }

    const url = tab.currentUrl || tab.url;
    const exists = bookmarksRef.current.some((item) => item.url === url);

    setBookmarks((items) =>
      exists
        ? items.filter((item) => item.url !== url)
        : [
            ...items,
            {
              title: tab.title || getTitleFromUrl(url),
              url,
              createdAt: new Date().toISOString(),
            },
          ]
    );

    notify(exists ? "Bookmark removed" : "Bookmark added");
  }, [notify]);

  const openBookmark = useCallback(
    (bookmark, options) => {
      navigate(bookmark.url, options);
      if (!options?.newTab) setSidebarOpen(false);
    },
    [navigate]
  );

  const addShortcut = useCallback(
    (name, rawUrl) => {
      const url = getNavigationUrl(rawUrl, "fades");

      if (!isNativeUrl(url)) {
        notify("Enter a website address");

        return false;
      }

      setShortcuts((items) =>
        items.some((item) => item.url === url)
          ? items
          : [...items, { name: name.trim() || getTitleFromUrl(url), url }]
      );

      return true;
    },
    [notify]
  );

  const updateSetting = useCallback((key, value) => {
    setSettings((current) => ({ ...current, [key]: value }));
  }, []);

  const exportData = useCallback(() => {
    downloadJson("fades-browser-backup.json", {
      app: "fades-browser",
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      bookmarks,
      history,
      shortcuts,
      settings,
    });

    notify("Backup exported");
  }, [bookmarks, history, shortcuts, settings, notify]);

  const mergeByUrl = (local, incoming) => {
    const map = new Map(local.map((item) => [item.url, item]));

    (incoming || []).forEach((item) => {
      if (item && item.url && !map.has(item.url)) map.set(item.url, item);
    });

    return [...map.values()];
  };

  const mergeHistory = (local, incoming) => {
    const map = new Map(local.map((item) => [item.url, item]));

    (incoming || []).forEach((item) => {
      if (!item || !item.url) return;

      const existing = map.get(item.url);

      if (!existing) {
        map.set(item.url, item);
      } else {
        map.set(item.url, {
          ...existing,
          visits: Math.max(existing.visits || 1, item.visits || 1),
          visitedAt:
            new Date(item.visitedAt) > new Date(existing.visitedAt)
              ? item.visitedAt
              : existing.visitedAt,
        });
      }
    });

    return [...map.values()]
      .sort((a, b) => new Date(b.visitedAt) - new Date(a.visitedAt))
      .slice(0, 500);
  };

  const importData = useCallback(
    async (file) => {
      if (!file) return;

      try {
        const data = JSON.parse(await file.text());

        setBookmarks((items) => mergeByUrl(items, data.bookmarks));
        setHistory((items) => mergeHistory(items, data.history));
        setShortcuts((items) =>
          mergeByUrl(
            items.map((item) => ({ ...item })),
            data.shortcuts
          )
        );

        notify("Backup imported");
      } catch {
        notify("That file isn't a valid backup");
      }
    },
    [notify]
  );

  const clearHistory = useCallback(() => {
    setHistory([]);
    notify("History cleared");
  }, [notify]);

  const clearAllData = useCallback(() => {
    setHistory([]);
    setBookmarks([]);
    setDownloads([]);
    setClosedTabs([]);
    setShortcuts(DEFAULT_QUICK_LINKS);
    setSettings(DEFAULT_SETTINGS);
    notify("Browsing data cleared");
  }, [notify]);

  /* =======================================================
   * ACCOUNT / SYNC
   * ======================================================= */

const refreshAccount = useCallback(async () => {
  if (!getToken()) {
    setAccount((c) => ({ ...c, status: "signedOut", user: null }));

    return;
  }

  try {
    const data = await authFetch("/me");
    const user = data && (data.user || (data.username || data.id ? data : null));

    setAccount((c) => ({
      ...c,
      status: user ? "signedIn" : "signedOut",
      user: user || null,
      message: "",
    }));
  } catch (error) {
    if (error.status === 401) {
      setToken("");
      setAccount((c) => ({
        ...c,
        status: "signedOut",
        user: null,
        message: "Your session expired. Sign in again.",
      }));
    } else {
      setAccount((c) => ({
        ...c,
        status: "error",
        user: null,
        message: "Could not reach the Fades service.",
      }));
    }
  }
}, []);

  const buildPayload = useCallback((overrides = {}) => {
    const data = dataRef.current;

    return {
      version: APP_VERSION,
      updatedAt: new Date().toISOString(),
      bookmarks: data.bookmarks,
      history: data.history.slice(0, 200),
      shortcuts: data.shortcuts,
      settings: data.settings,
      tabs: data.tabs
        .filter((tab) => !tab.private && !tab.url.startsWith(FADES_LOGIN_BASE))
        .map((tab) => ({ url: tab.url, title: tab.title, pinned: tab.pinned })),
      ...overrides,
    };
  }, []);

  const syncNow = useCallback(async () => {
    setAccount((current) => ({ ...current, syncing: true, message: "" }));

    try {
      const cloud = await apiFetch(SYNC_ROUTES.pull);
      const local = dataRef.current;

      const mergedBookmarks = mergeByUrl(local.bookmarks, cloud?.bookmarks);
      const mergedHistory = mergeHistory(local.history, cloud?.history);
      const mergedShortcuts = mergeByUrl(local.shortcuts, cloud?.shortcuts);

      setBookmarks(mergedBookmarks);
      setHistory(mergedHistory);
      setShortcuts(mergedShortcuts);

      await apiFetch(SYNC_ROUTES.push, {
        method: "POST",
        body: JSON.stringify(
          buildPayload({
            bookmarks: mergedBookmarks,
            history: mergedHistory.slice(0, 200),
            shortcuts: mergedShortcuts,
          })
        ),
      });

      setAccount((current) => ({
        ...current,
        syncing: false,
        lastSync: new Date().toISOString(),
        message: "Synced",
      }));
    } catch (error) {
      setAccount((current) => ({
        ...current,
        syncing: false,
        message: `Sync failed (${error.status || "network"})`,
      }));
    }
  }, [buildPayload]);

  const backupToCloud = useCallback(async () => {
    setAccount((current) => ({ ...current, syncing: true, message: "" }));

    try {
      await apiFetch(SYNC_ROUTES.push, {
        method: "POST",
        body: JSON.stringify(buildPayload()),
      });

      setAccount((current) => ({
        ...current,
        syncing: false,
        lastSync: new Date().toISOString(),
        message: "Backed up to your account",
      }));
    } catch (error) {
      setAccount((current) => ({
        ...current,
        syncing: false,
        message: `Backup failed (${error.status || "network"})`,
      }));
    }
  }, [buildPayload]);

  const deleteCloudData = useCallback(async () => {
    try {
      await apiFetch(SYNC_ROUTES.wipe, { method: "DELETE" });
      setAccount((current) => ({ ...current, message: "Cloud data deleted" }));
    } catch (error) {
      setAccount((current) => ({
        ...current,
        message: `Delete failed (${error.status || "network"})`,
      }));
    }
  }, []);

useEffect(() => {
  if (browserReady) refreshAccount();
}, [browserReady, refreshAccount]);

const signIn = useCallback(() => {
  const code = makeLinkCode();
  const tabId = openTab(`${FADES_LOGIN_BASE}?from=browser&code=${code}`);

  setPendingSignIn({ code, userCode: formatUserCode(code), tabId, startedAt: Date.now() });
  setAccount((c) => ({ ...c, message: "" }));
}, [openTab]);

const signOut = useCallback(async () => {
  try {
    await authFetch("/browser/logout", { method: "POST" });
  } catch {}

  setToken("");
  setPendingSignIn(null);
  setAccount({ status: "signedOut", user: null, syncing: false, message: "Signed out", lastSync: "" });
}, []);

useEffect(() => {
  if (!pendingSignIn) return;

  const { code, tabId, startedAt } = pendingSignIn;
  let stopped = false;
  let timer;

  const finishWith = (patch, toastMessage) => {
    setPendingSignIn(null);
    setAccount((c) => ({ ...c, ...patch }));
    if (toastMessage) notify(toastMessage);
  };

  const tick = async () => {
    if (stopped) return;

    if (Date.now() - startedAt > SIGNIN_TIMEOUT_MS) {
      finishWith({ message: "Sign-in timed out. Try again." });

      return;
    }

    try {
      const response = await fetch(`${FADES_AUTH_API}/browser/claim`, {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ code }),
      });

      if (stopped) return;

      if (response.status === 200) {
        const data = await response.json();

        setToken(data.token);
        finishWith({ status: "signedIn", user: data.user || null, message: "" }, "Signed in");
        closeTab(tabId);

        return;
      }

      if (response.status === 410 || response.status === 400) {
        finishWith({ message: "That sign-in expired. Try again." });

        return;
      }
    } catch {
      /* network blip, keep polling */
    }

    timer = setTimeout(tick, 2000);
  };

  timer = setTimeout(tick, 1500);

  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}, [pendingSignIn, closeTab, notify]);


  useEffect(() => {
    if (sidebarOpen && sidebarPage === "account") refreshAccount();
  }, [sidebarOpen, sidebarPage, refreshAccount]);

  useEffect(() => {
    if (!settings.autoSync || account.status !== "signedIn") return;

    const timer = setTimeout(() => {
      apiFetch(SYNC_ROUTES.push, {
        method: "POST",
        body: JSON.stringify(buildPayload()),
      }).catch(() => {});
    }, 5000);

    return () => clearTimeout(timer);
  }, [settings.autoSync, account.status, bookmarks, history, shortcuts, buildPayload]);

  /* =======================================================
   * ADDRESS BAR + OMNIBOX
   * ======================================================= */

  useEffect(() => {
    if (!currentTab) {
      setAddress("");

      return;
    }

    setAddressDirty(false);
    setOmniIndex(-1);

    if (currentTab.url === NEW_TAB_URL) setAddress("");
    else if (isFadesSearchUrl(currentTab.url)) {
      setAddress(getSearchQueryFromUrl(currentTab.url));
    } else if (currentTab.url.startsWith("fades://")) setAddress("");
    else setAddress(currentTab.currentUrl || currentTab.url);
  }, [currentTab?.id, currentTab?.url, currentTab?.currentUrl]);

  useEffect(() => {
    const query = address.trim();

    if (
      !addressDirty ||
      !omniFocused ||
      query.length < 2 ||
      !settings.searchSuggestions ||
      suggestFailures.current >= 3
    ) {
      setRemoteSuggestions([]);

      return;
    }

    const controller = new AbortController();

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `${FADES_SUGGEST_API}?q=${encodeURIComponent(query)}`,
          {
            signal: controller.signal,
            credentials: "include",
            headers: { Accept: "application/json" },
          }
        );

        if (!response.ok) throw new Error(String(response.status));

        const data = await response.json();
        const list = (Array.isArray(data) ? data : data.suggestions || data.results || [])
          .map((item) => (typeof item === "string" ? item : item.query || item.text || item.title || ""))
          .filter(Boolean)
          .slice(0, 6);

        suggestFailures.current = 0;
        setRemoteSuggestions(list);
      } catch (error) {
        if (error.name !== "AbortError") suggestFailures.current += 1;
      }
    }, 180);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [address, addressDirty, omniFocused, settings.searchSuggestions]);

  const omniItems = useMemo(() => {
    const query = address.trim();

    if (!addressDirty || !query) return [];

    const lower = query.toLowerCase();
    const items = [];
    const seen = new Set();

    const push = (item) => {
      if (seen.has(item.value)) return;

      seen.add(item.value);
      items.push(item);
    };

    push({
      type: "primary",
      value: query,
      text: query,
      sub: isExplicitUrl(query)
        ? "Open address"
        : `Search ${SEARCH_ENGINES[settings.engine]?.name || "Fades"}`,
    });

    bookmarks
      .filter(
        (item) =>
          item.title.toLowerCase().includes(lower) ||
          item.url.toLowerCase().includes(lower)
      )
      .slice(0, 3)
      .forEach((item) =>
        push({ type: "bookmark", value: item.url, text: item.title, sub: item.url })
      );

    history.forEach((item) => {
      if (items.length >= 8) return;

      if (isFadesSearchUrl(item.url)) {
        const text = getSearchQueryFromUrl(item.url);

        if (text.toLowerCase().includes(lower)) {
          push({ type: "recent", value: text, text, sub: "Recent search" });
        }
      } else if (
        item.title.toLowerCase().includes(lower) ||
        item.url.toLowerCase().includes(lower)
      ) {
        push({ type: "history", value: item.url, text: item.title, sub: item.url });
      }
    });

    remoteSuggestions.forEach((text) =>
      push({ type: "suggest", value: text, text, sub: "" })
    );

    return items.slice(0, 9);
  }, [address, addressDirty, bookmarks, history, remoteSuggestions, settings.engine]);

  const omniOpen = omniFocused && omniItems.length > 0;
  const overlayHidden = omniOpen || Boolean(tabMenu) || downloadFlyout;

  const pickOmniItem = useCallback(
    (item, options = {}) => {
      navigate(item.value, options);
      setOmniFocused(false);
      addressRef.current?.blur();
    },
    [navigate]
  );

  const handleAddressKeyDown = (event) => {
    if (event.key === "ArrowDown" && omniItems.length > 0) {
      event.preventDefault();
      setOmniIndex((index) => (index + 1) % omniItems.length);
    } else if (event.key === "ArrowUp" && omniItems.length > 0) {
      event.preventDefault();
      setOmniIndex((index) => (index <= 0 ? omniItems.length - 1 : index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();

      const options = event.altKey ? { newTab: true } : {};

      if (omniIndex >= 0 && omniItems[omniIndex]) {
        pickOmniItem(omniItems[omniIndex], options);
      } else {
        navigate(address, options);
        setOmniFocused(false);
        addressRef.current?.blur();
      }
    } else if (event.key === "Escape") {
      setOmniFocused(false);
      setAddressDirty(false);
      setAddress(
        currentTab
          ? isFadesSearchUrl(currentTab.url)
            ? getSearchQueryFromUrl(currentTab.url)
            : currentTab.url === NEW_TAB_URL
            ? ""
            : currentUrl
          : ""
      );
      addressRef.current?.blur();
    }
  };

  /* =======================================================
   * TAURI TAB UPDATES (optional Rust event)
   * ======================================================= */

useEffect(() => {
  let unlisten = () => {};
  let cancelled = false;

  listenTauri("fades-tab-update", (event) => {
    const payload = event?.payload || {};
    const tabId = getTabIdFromLabel(payload.label);

    if (tabId === null) return;

    const tab = tabsRef.current.find((item) => item.id === tabId);

    if (!tab) return;

    const patch = { loading: false };

    if (payload.url) patch.currentUrl = payload.url;
    if (payload.title) patch.title = payload.title;

    updateTab(tabId, patch);

    if (payload.url && payload.url !== tab.currentUrl) {
      recordHistory(payload.url, payload.title || tab.title, tab.private);
    }
  }).then((fn) => {
    if (cancelled) fn();
    else unlisten = fn;
  });

  return () => {
    cancelled = true;
    unlisten();
  };
}, [recordHistory, updateTab]);

/* ---------- NEW: downloads ---------- */
useEffect(() => {
  let unlisten = () => {};
  let cancelled = false;

  listenTauri("fades-download", (event) => {
    const p = event?.payload || {};

    if (!p.url) return;

    const tab = tabsRef.current.find((t) => t.id === getTabIdFromLabel(p.label));

    if (tab?.private) return;

    const name =
      (p.path || "").split(/[\\/]/).pop() ||
      p.url.split("?")[0].split("/").pop() ||
      "Download";

    setDownloads((items) => {
      const index = items.findIndex(
        (d) => d.url === p.url && d.status === "downloading"
      );

      if (p.status === "started" || index < 0) {
        return [
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name,
            url: p.url,
            path: p.path || "",
            status: p.status === "started" ? "downloading" : p.status,
            at: new Date().toISOString(),
          },
          ...items,
        ].slice(0, 100);
      }

      return items.map((d, i) =>
        i === index
          ? { ...d, status: p.status, path: p.path || d.path, name: p.path ? name : d.name }
          : d
      );
    });

 if (p.status === "started") showDownloadFlyout(7000);
if (p.status === "done") showDownloadFlyout(5000);
if (p.status === "failed") showDownloadFlyout(7000);
  }).then((fn) => {
    if (cancelled) fn();
    else unlisten = fn;
  });

  return () => {
    cancelled = true;
    unlisten();
  };
}, [notify, openSidebar]);

const handleLoadState = useCallback(
  (tabId, loading) => updateTab(tabId, { loading }),
  [updateTab]
);

  /* =======================================================
   * KEYBOARD SHORTCUTS
   * ======================================================= */

  const actionsRef = useRef({});

  actionsRef.current = {
    focusAddress: () => {
      addressRef.current?.focus();
      addressRef.current?.select();
    },
    newTab: () => openTab(NEW_TAB_URL),
    newPrivateTab: () => openTab(NEW_TAB_URL, { isPrivate: true }),
    reopen: () => reopenClosedTab(0),
    closeActive: () => currentTabRef.current && closeTab(currentTabRef.current.id),
    reload: () => reloadPage(),
    bookmark: toggleBookmark,
    openPanel: openSidebar,
    toggleBar: () => updateSetting("showBookmarksBar", !settingsRef.current.showBookmarksBar),
    find: openFind,
    back: goBack,
    forward: goForward,
    home: goHome,
    zoom: changeZoom,
    print: printPage,
    fullscreen: toggleFullscreen,
    cycle: cycleTab,
    jump: jumpToTab,
    toggleDownloads: () =>
      downloadFlyout ? hideDownloadFlyout() : showDownloadFlyout(),
    escape: () => {
      if (downloadFlyout) hideDownloadFlyout();
      else if (tabMenu) setTabMenu(null);
      else if (findOpen) closeFind();
      else if (sidebarOpen) setSidebarOpen(false);

      addressRef.current?.blur();
    },
  };


  useEffect(() => {
    const onKeyDown = (event) => {
      const a = actionsRef.current;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const handle = (fn) => {
        event.preventDefault();
        fn();
      };

      if (key === "escape") return a.escape();

      if (event.altKey && !mod) {
        if (event.key === "ArrowLeft") return handle(a.back);
        if (event.key === "ArrowRight") return handle(a.forward);
        if (event.key === "Home") return handle(a.home);
        if (key === "d") return handle(a.focusAddress);

        return;
      }

      if (key === "f5") return handle(a.reload);
      if (key === "f6") return handle(a.focusAddress);
      if (key === "f11") return handle(a.fullscreen);

      if (!mod) return;

      if (event.shiftKey) {
        if (key === "t") return handle(a.reopen);
        if (key === "n" || key === "p") return handle(a.newPrivateTab);
        if (key === "b") return handle(a.toggleBar);
        if (key === "o") return handle(() => a.openPanel("bookmarks"));
        if (key === "delete") return handle(() => a.openPanel("settings"));
        if (key === "tab") return handle(() => a.cycle(-1));
        if (key === "r") return handle(a.reload);
        if (key === "=" || key === "+") return handle(() => a.zoom(1));

        return;
      }

      if (/^[1-9]$/.test(key)) return handle(() => a.jump(Number(key)));

      switch (key) {
        case "t":
          return handle(a.newTab);
        case "w":
        case "f4":
          return handle(a.closeActive);
        case "l":
        case "k":
        case "e":
          return handle(a.focusAddress);
        case "r":
          return handle(a.reload);
        case "d":
          return handle(a.bookmark);
        case "h":
          return handle(() => a.openPanel("history"));
        case "j":
          return handle(() => a.openPanel("downloads"));
        case "f":
          return handle(a.find);
        case "p":
          return handle(a.print);
        case ",":
          return handle(() => a.openPanel("settings"));
        case "tab":
        case "pagedown":
          return handle(() => a.cycle(1));
        case "pageup":
          return handle(() => a.cycle(-1));
        case "=":
        case "+":
          return handle(() => a.zoom(1));
        case "-":
          return handle(() => a.zoom(-1));
        case "0":
          return handle(() => a.zoom("reset"));
        default:
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tabMenu, findOpen, sidebarOpen, closeFind]);

  /* =======================================================
   * TITLEBAR
   * ======================================================= */

  const handleTitlebarDoubleClick = async (event) => {
    if (event.target.closest("button, input, form, .tab, .find-bar")) return;

    await toggleMaximizeWindow();

    setTimeout(async () => {
      try {
        setIsMaximized(await (await getTauriWindow())?.isMaximized());
      } catch {}
    }, 100);
  };

  const handleWindowDrag = (event) => {
    if (event.button !== 0) return;

    if (
      event.target.closest(
        "button, input, form, .tab, .window-controls, .find-bar, .omnibox-dropdown"
      )
    ) {
      return;
    }

    startWindowDrag();
  };

  const handleTabMouseDown = (event, tabId) => {
    if (event.button === 1) {
      event.preventDefault();
      closeTab(tabId);
    }
  };

  const handleTabContextMenu = (event, tabId) => {
    event.preventDefault();

    setTabMenu({
      tabId,
      x: clamp(event.clientX, 8, window.innerWidth - 240),
      y: event.clientY + 6,
    });
  };

  /* =======================================================
   * RENDER
   * ======================================================= */

  if (!browserReady) {
    return (
      <main className="browser browser-loading-shell">
        <div className="browser-loading-logo">
          <img src={FADES_LOGO} alt="Fades" />
        </div>

        <span>Starting Fades Browser...</span>
      </main>
    );
  }

  const isNewTabPage = currentTab?.url === NEW_TAB_URL;
  const isSearchPage = isFadesSearchUrl(currentTab?.url);
  const nativeTabs = tabs.filter(
    (tab) => isNativeTab(tab) && activated.includes(tab.id)
  );
  const menuTab = tabMenu ? tabs.find((tab) => tab.id === tabMenu.tabId) : null;
  const engineName = SEARCH_ENGINES[settings.engine]?.name || "Fades";
  const canGoBack =
    currentTab && (currentTab.backStack.length > 0 || isNativeTab(currentTab));
  const canGoForward =
    currentTab && (currentTab.forwardStack.length > 0 || isNativeTab(currentTab));
  const securityState = !currentTab
    ? "internal"
    : !isNativeTab(currentTab)
    ? "internal"
    : currentUrl.startsWith("https://")
    ? "secure"
    : "insecure";

  const sidebarTitles = {
    menu: "Fades Browser",
    account: "Account",
    bookmarks: "Bookmarks",
    history: "History",
    downloads: "Downloads",
    tabs: "Tabs",
    settings: "Settings",
    shortcuts: "Keyboard shortcuts",
  };

  const menuActions = {
    newTab: () => openTab(NEW_TAB_URL),
    privateTab: () => openTab(NEW_TAB_URL, { isPrivate: true }),
    duplicate: () => duplicateTab(),
    reopen: () => reopenClosedTab(0),
    find: openFind,
    print: printPage,
    copyLink,
    fullscreen: toggleFullscreen,
    zoom: changeZoom,
    help: () => openTab(FADES_HOME_URL),
    clearData: () => openSidebar("settings"),
  };

  return (
    <main className="browser">
      <div className="browser-glow glow-one" />
      <div className="browser-glow glow-two" />

      {/* ================= TITLEBAR + TOOLBAR ================= */}

      <header
        className="browser-header"
        onMouseDown={handleWindowDrag}
        onDoubleClick={handleTitlebarDoubleClick}
      >
        <div className="tab-strip">
          <div className="window-brand">
            <img
              src={FADES_LOGO}
              alt="Fades"
              className="fades-logo-image"
              draggable={false}
            />
          </div>

          <button
            className="tab-search"
            onClick={() => openSidebar("tabs")}
            title="Search tabs"
            aria-label="Search tabs"
          >
            ⌄
          </button>

          <div className="tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={`tab ${tab.id === currentTab?.id ? "active" : ""} ${
                  tab.private ? "private" : ""
                } ${tab.pinned ? "pinned" : ""} ${tab.loading ? "loading" : ""}`}
                onClick={() => switchTab(tab.id)}
                onMouseDown={(event) => handleTabMouseDown(event, tab.id)}
                onContextMenu={(event) => handleTabContextMenu(event, tab.id)}
                title={tab.private ? `Private tab – ${tab.title}` : tab.title}
              >
                <span className="tab-favicon">
                  {tab.loading ? (
                    <span className="tab-spinner" />
                  ) : tab.private ? (
                    "◌"
                  ) : tab.url === NEW_TAB_URL ? (
                    <img src={FADES_LOGO} alt="" draggable={false} />
                  ) : isFadesSearchUrl(tab.url) ? (
                    "⌕"
                  ) : settings.showSiteIcons ? (
                    <SiteIcon url={tab.url} />
                  ) : (
                    "◉"
                  )}
                </span>

                {!tab.pinned && (
                  <>
                    <span className="tab-title">{tab.title || "New Tab"}</span>

                    <span
                      className="tab-close"
                      onClick={(event) => closeTab(tab.id, event)}
                      aria-label="Close tab"
                    >
                      ×
                    </span>
                  </>
                )}
              </button>
            ))}

            <button
              className="new-tab"
              onClick={() => openTab(NEW_TAB_URL)}
              title="New Tab (Ctrl+T)"
            >
              +
            </button>
          </div>

          <div
            className="window-controls"
            onMouseDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <button
              className="window-button"
              onClick={minimizeWindow}
              title="Minimize"
              aria-label="Minimize"
            >
              <span />
            </button>

            <button
              className="window-button"
              onClick={async () => {
                await toggleMaximizeWindow();
                setTimeout(async () => {
                  try {
                    setIsMaximized(await (await getTauriWindow())?.isMaximized());
                  } catch {}
                }, 100);
              }}
              title={isMaximized ? "Restore" : "Maximize"}
              aria-label={isMaximized ? "Restore" : "Maximize"}
            >
              {isMaximized ? (
                <span className="restore-icon" />
              ) : (
                <span className="maximize-icon" />
              )}
            </button>

            <button
              className="window-button close"
              onClick={closeWindow}
              title="Close"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        <div className="toolbar">
          <div
            className="navigation-buttons"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="toolbar-button"
              title="Back (Alt+Left)"
              onClick={goBack}
              disabled={!canGoBack}
            >
              <Icon>‹</Icon>
            </button>

            <button
              className="toolbar-button"
              title="Forward (Alt+Right)"
              onClick={goForward}
              disabled={!canGoForward}
            >
              <Icon>›</Icon>
            </button>

            <button
              className="toolbar-button"
              title="Reload (Ctrl+R)"
              onClick={() => reloadPage()}
              disabled={!currentTab || isNewTabPage}
            >
              <Icon>↻</Icon>
            </button>

            {settings.showHomeButton && (
              <button
                className="toolbar-button"
                title="Home (Alt+Home)"
                onClick={goHome}
              >
                <Icon>⌂</Icon>
              </button>
            )}
          </div>

          <form
            className={`address-container ${omniOpen ? "omni-open" : ""}`}
            onSubmit={(event) => event.preventDefault()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className={`site-info ${securityState}`}
              title={
                securityState === "secure"
                  ? "Secure connection – click to copy link"
                  : securityState === "insecure"
                  ? "Not secure – click to copy link"
                  : "Fades page"
              }
              onClick={copyLink}
            >
              <span className="secure-dot" />
            </button>

            <input
              ref={addressRef}
              value={address}
              onChange={(event) => {
                setAddress(event.target.value);
                setAddressDirty(true);
                setOmniIndex(-1);
              }}
              onFocus={(event) => {
                setOmniFocused(true);
                event.target.select();
              }}
              onBlur={() => setOmniFocused(false)}
              onKeyDown={handleAddressKeyDown}
              placeholder={`Search with ${engineName} or enter an address`}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              aria-label="Address bar"
              autoComplete="off"
            />

            {address && (
              <button
                type="button"
                className="address-clear"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setAddress("");
                  setAddressDirty(true);
                  addressRef.current?.focus();
                }}
                title="Clear"
              >
                ×
              </button>
            )}

            {currentTab && currentTab.zoom !== 1 && (
              <button
                type="button"
                className="zoom-pill"
                onClick={() => changeZoom("reset")}
                title="Reset zoom"
              >
                {Math.round(currentTab.zoom * 100)}%
              </button>
            )}

            <button
              type="button"
              className={`address-star ${isBookmarked ? "bookmarked" : ""}`}
              onClick={toggleBookmark}
              disabled={!currentTab || !isNativeTab(currentTab)}
              title={isBookmarked ? "Remove bookmark (Ctrl+D)" : "Bookmark this page (Ctrl+D)"}
            >
              {isBookmarked ? "★" : "☆"}
            </button>

            {omniOpen && (
              <div className="omnibox-dropdown">
                {omniItems.map((item, index) => (
                  <button
                    type="button"
                    key={`${item.type}-${item.value}`}
                    className={`omni-item ${index === omniIndex ? "selected" : ""}`}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      pickOmniItem(item, event.button === 1 ? { newTab: true } : {});
                    }}
                    onMouseEnter={() => setOmniIndex(index)}
                  >
                    <span className="omni-icon">
                      {item.type === "bookmark"
                        ? "★"
                        : item.type === "history"
                        ? "◷"
                        : item.type === "recent"
                        ? "↺"
                        : "⌕"}
                    </span>

                    <span className="omni-text">{item.text}</span>

                    {item.sub && <span className="omni-sub">{item.sub}</span>}
                  </button>
                ))}
              </div>
            )}
          </form>

          <div
            className="fades-search-badge"
            title={`Default search: ${engineName}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <img src={FADES_LOGO} alt="" draggable={false} />

            <span>{engineName}</span>
          </div>

          <button
                    className={`toolbar-button download-button ${
                    downloads.some((d) => d.status === "downloading") ? "active" : ""
          }`}
                   onClick={() => (downloadFlyout ? hideDownloadFlyout() : showDownloadFlyout())}
                  title="Downloads (Ctrl+J)"
                    >
                   <Icon>↓</Icon>
                   </button>

          <button
            className="toolbar-button menu-button"
            onClick={() => openSidebar("menu")}
            title="Settings and more"
          >
            ⋮
          </button>

          <button
            className="account-button"
            onClick={() => openSidebar("account")}
            title="Fades Account"
          >
            <img
              src={FADES_LOGO}
              alt="Fades"
              className="account-avatar-image"
              draggable={false}
            />
          </button>
        </div>

        {findOpen && (
          <div
            className="find-bar"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span className="find-label">Find in page</span>

            <input
              ref={findRef}
              className="find-input"
              value={findText}
              placeholder="Find…"
              spellCheck={false}
              onChange={(event) => {
                setFindText(event.target.value);
                runFind(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  runFind(findText, event.shiftKey);
                } else if (event.key === "Escape") {
                  closeFind();
                }
              }}
            />

            <div className="find-buttons">
              <button onClick={() => runFind(findText, true)} title="Previous (Shift+Enter)">
                ↑
              </button>

              <button onClick={() => runFind(findText, false)} title="Next (Enter)">
                ↓
              </button>

              <button onClick={closeFind} title="Close (Esc)">
                ×
              </button>
            </div>
          </div>
        )}

        {settings.showBookmarksBar && (
          <div className="bookmarks-bar">
            <div className="bookmarks-left">
              <button
                className="bookmark-folder"
                onClick={() => openSidebar("bookmarks")}
              >
                <span>▾</span>
                Bookmarks
              </button>

              {bookmarks.slice(0, 14).map((bookmark) => (
                <button
                  key={bookmark.url}
                  className="bookmark-item"
                  onClick={(event) =>
                    openBookmark(bookmark, { newTab: event.ctrlKey || event.metaKey })
                  }
                  onAuxClick={(event) => {
                    if (event.button === 1) {
                      event.preventDefault();
                      openBookmark(bookmark, { newTab: true, activate: false });
                    }
                  }}
                  title={bookmark.url}
                >
                  <span className="bookmark-favicon">
                    <SiteIcon url={bookmark.url} fallback="★" />
                  </span>

                  <span>{bookmark.title}</span>
                </button>
              ))}

              {bookmarks.length === 0 && (
                <span className="bookmark-empty">
                  Your bookmarks will appear here
                </span>
              )}
            </div>

            <button
              className="bookmark-toggle"
              onClick={() => updateSetting("showBookmarksBar", false)}
              title="Hide bookmarks bar (Ctrl+Shift+B)"
            >
              −
            </button>
          </div>
        )}

        {currentTab?.loading && <div className="load-bar" />}
      </header>

      {/* ================= BODY ================= */}

      <div className="browser-body">
        <section className="browser-content">
          {isNewTabPage ? (
            <NewTab
              key={currentTab.id}
              settings={settings}
              clock={clock}
              privateTab={currentTab.private}
              bookmarks={bookmarks}
              history={history}
              shortcuts={shortcuts}
              closedTabs={closedTabs}
              onSearch={navigate}
              onOpen={(url, options) => navigate(url, options)}
              onAddShortcut={addShortcut}
              onRemoveShortcut={(url) =>
                setShortcuts((items) => items.filter((item) => item.url !== url))
              }
              onReopenClosed={reopenClosedTab}
            />
          ) : isSearchPage ? (
            <FadesSearchPage
              key={currentTab.id}
              query={getSearchQueryFromUrl(currentTab.url)}
              type={getSearchTypeFromUrl(currentTab.url)}
              time={getSearchTimeFromUrl(currentTab.url)}
              reloadKey={getSearchReloadFromUrl(currentTab.url)}
              safeSearch={settings.safeSearch}
              onSearch={searchFromPage}
              onOpenResult={navigateToResult}
            />
          ) : isNativeTab(currentTab) ? (
            <div className="browser-page native-browser-page">
              <div className="native-browser-loading">
                <img src={FADES_LOGO} alt="" draggable={false} />

                <div className="native-browser-spinner" />

                <span>Loading {currentTab.title || getTitleFromUrl(currentTab.url)}</span>
              </div>
            </div>
          ) : null}
        </section>

        {sidebarOpen && (
          <aside className="browser-sidebar docked">
            <div className="sidebar-header">
              <div className="sidebar-title">
                {sidebarPage !== "menu" && sidebarPage !== "account" && (
                  <button
                    className="sidebar-back"
                    onClick={() => setSidebarPage(sidebarPage === "shortcuts" ? "settings" : "menu")}
                    title="Back"
                  >
                    ‹
                  </button>
                )}

                {sidebarTitles[sidebarPage] || "Fades Browser"}
              </div>

              <button className="sidebar-close" onClick={closeSidebar}>
                ×
              </button>
            </div>

            {sidebarPage === "menu" && (
              <Menu
                zoom={currentTab?.zoom || 1}
                canReopen={closedTabs.length > 0}
                onOpen={openSidebar}
                actions={menuActions}
                onClose={closeSidebar}
              />
            )}

            {sidebarPage === "bookmarks" && (
              <BookmarkPanel
                bookmarks={bookmarks}
                onOpen={openBookmark}
                onDelete={(url) =>
                  setBookmarks((items) => items.filter((item) => item.url !== url))
                }
                onRename={(url, title) =>
                  setBookmarks((items) =>
                    items.map((item) => (item.url === url ? { ...item, title } : item))
                  )
                }
                onExport={exportData}
                onImport={importData}
              />
            )}

            {sidebarPage === "history" && (
              <HistoryPanel
                history={history}
                onOpen={(url, options) => {
                  navigate(url, options);
                  if (!options?.newTab) closeSidebar();
                }}
                onDelete={(url) =>
                  setHistory((items) => items.filter((item) => item.url !== url))
                }
                onClear={clearHistory}
              />
            )}

            {sidebarPage === "downloads" && (
              <DownloadPanel downloads={downloads} onClear={() => setDownloads([])} />
            )}

            {sidebarPage === "tabs" && (
              <TabsPanel
                tabs={tabs}
                activeTab={currentTab?.id}
                onSwitch={switchTab}
                onClose={closeTab}
                onNew={() => openTab(NEW_TAB_URL)}
              />
            )}

            {sidebarPage === "account" && (
                            <AccountPanel
                            account={account}
                            pending={pendingSignIn}
                            autoSync={settings.autoSync}
                            onToggleAutoSync={(value) => updateSetting("autoSync", value)}
                            onSignIn={signIn}
                           onCancelSignIn={() => setPendingSignIn(null)}
                           onSignOut={signOut}
                            onRefresh={refreshAccount}
                             onSync={syncNow}
                             onBackup={backupToCloud}
                             onDeleteCloud={deleteCloudData}
                               />            
              )}

            {sidebarPage === "settings" && (
              <SettingsPanel
                settings={settings}
                onChange={updateSetting}
                onOpenPanel={openSidebar}
                onClearHistory={clearHistory}
                onClearAll={clearAllData}
                onExport={exportData}
                onImport={importData}
              />
            )}

            {sidebarPage === "shortcuts" && <ShortcutsPanel />}
          </aside>
        )}
      </div>

      {/* ================= NATIVE WEBVIEWS ================= */}

      {nativeTabs.map((tab) => (
        <BrowserPage
          key={tab.id}
          tab={tab}
          shouldShow={tab.id === currentTab?.id && !overlayHidden}
          top={topOffset}
          right={rightInset}
          onLoadState={handleLoadState}
        />
      ))}

      {/* ================= TAB CONTEXT MENU ================= */}

      {tabMenu && menuTab && (
        <>
          <div
            className="context-overlay"
            onMouseDown={() => setTabMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault();
              setTabMenu(null);
            }}
          />

          <div className="context-menu" style={{ left: tabMenu.x, top: tabMenu.y }}>
            {[
              {
                label: "New tab to the right",
                run: () => openTab(NEW_TAB_URL, { position: "after", afterId: menuTab.id }),
              },
              { label: "Reload", run: () => reloadPage(menuTab.id), off: !isNativeTab(menuTab) && !isFadesSearchUrl(menuTab.url) },
              { label: "Duplicate", run: () => duplicateTab(menuTab.id) },
              { label: menuTab.pinned ? "Unpin tab" : "Pin tab", run: () => togglePinTab(menuTab.id) },
              { label: "Move left", run: () => moveTab(menuTab.id, -1) },
              { label: "Move right", run: () => moveTab(menuTab.id, 1) },
              { sep: true },
              { label: "Close tab", run: () => closeTab(menuTab.id), hint: "Ctrl+W" },
              { label: "Close other tabs", run: () => closeOtherTabs(menuTab.id), off: tabs.length < 2 },
              { label: "Close tabs to the right", run: () => closeTabsToRight(menuTab.id) },
              { sep: true },
              { label: "Reopen closed tab", run: () => reopenClosedTab(0), off: closedTabs.length === 0, hint: "Ctrl+Shift+T" },
            ].map((item, index) =>
              item.sep ? (
                <div key={`sep-${index}`} className="context-sep" />
              ) : (
                <button
                  key={item.label}
                  className="context-item"
                  disabled={item.off}
                  onClick={() => {
                    setTabMenu(null);
                    item.run();
                  }}
                >
                  <span>{item.label}</span>

                  {item.hint && <kbd>{item.hint}</kbd>}
                </button>
              )
            )}
          </div>
        </>
      )}

      {/* ================= DOWNLOAD FLYOUT ================= */}

      {downloadFlyout && (
        <>
          <div className="context-overlay" onMouseDown={hideDownloadFlyout} />

          <DownloadFlyout
            downloads={downloads}
            top={TABSTRIP_HEIGHT + TOOLBAR_HEIGHT - 6}
            onMouseEnter={() => clearTimeout(flyoutTimer.current)}
            onShowAll={() => {
              hideDownloadFlyout();
              openSidebar("downloads");
            }}
            onNotify={notify}
          />
        </>
      )}

      {toast && (
        <div className="toast" key={toast.id} role="status">
          {toast.message}
        </div>
      )}
    </main>
  );
}

/*
 * =========================================================
 * NATIVE WEBVIEW (one per activated tab, kept alive hidden)
 * =========================================================
 */

function BrowserPage({ tab, shouldShow, top, right, onLoadState }) {
  const webviewRef = useRef(null);
  const shouldShowRef = useRef(shouldShow);
  const geometryRef = useRef({ top, right });
  const zoomRef = useRef(tab.zoom);
  const loadStateRef = useRef(onLoadState);

  shouldShowRef.current = shouldShow;
  geometryRef.current = { top, right };
  zoomRef.current = tab.zoom;
  loadStateRef.current = onLoadState;

  /* Create / recreate when the tab navigates */
  useEffect(() => {
    let cancelled = false;
    let created = null;

    const run = async () => {
      const Webview = await getTauriWebview();

      if (!Webview || cancelled) return;

      try {
        const label = getWebviewLabel(tab.id);
        const stale = await Webview.getByLabel(label);

        if (stale) {
          try {
            await stale.close();
          } catch {}

          await new Promise((resolve) => setTimeout(resolve, 80));
        }

        if (cancelled) return;

        const { top: y, right: inset } = geometryRef.current;

        /* Created in Rust so we can hook downloads (on_download) */
        const result = await tauriInvoke("create_tab_webview", {
          label,
          url: tab.url,
          x: 0,
          y,
          width: Math.max(320, window.innerWidth - inset),
          height: Math.max(250, window.innerHeight - y),
          incognito: Boolean(tab.private),
        });

        if (!result.ok) throw result.error;

        const webview = await Webview.getByLabel(label);

        if (!webview) throw new Error("WebView was not created");

        /* Effect was cleaned up while the command was running */
        if (cancelled) {
          try {
            await webview.close();
          } catch {}

          return;
        }

        created = webview;
        webviewRef.current = webview;

        await positionTabWebview(webview, geometryRef.current);

        try {
          await webview.setZoom(zoomRef.current);
        } catch {}

        try {
          if (shouldShowRef.current) {
            await webview.show();
            await webview.setFocus();
          } else {
            await webview.hide();
          }
        } catch {}

        setTimeout(() => loadStateRef.current(tab.id, false), 900);
      } catch (error) {
        console.error("[Fades Browser] Failed to create WebView:", error);
        loadStateRef.current(tab.id, false);
      }
    };

    run();

    return () => {
      cancelled = true;

      const webview = created || webviewRef.current;

      webviewRef.current = null;

      if (webview) webview.close().catch(() => {});
    };
  }, [tab.id, tab.url, tab.navKey, tab.private]);

  /* Show / hide */
  useEffect(() => {
    const webview = webviewRef.current;

    if (!webview) return;

    (async () => {
      try {
        if (shouldShow) {
          await positionTabWebview(webview, geometryRef.current);
          await webview.show();
          await webview.setFocus();
        } else {
          await webview.hide();
        }
      } catch {}
    })();
  }, [shouldShow]);

  /* Geometry */
  useEffect(() => {
    const apply = () => positionTabWebview(webviewRef.current, geometryRef.current);

    apply();
    window.addEventListener("resize", apply);

    return () => window.removeEventListener("resize", apply);
  }, [top, right]);

  /* Zoom */
  useEffect(() => {
    const webview = webviewRef.current;

    if (webview) webview.setZoom(tab.zoom).catch(() => {});
  }, [tab.zoom]);

  return null;
}

/*
 * =========================================================
 * NEW TAB
 * =========================================================
 */

function NewTab({
  settings,
  clock,
  privateTab,
  bookmarks,
  history,
  shortcuts,
  closedTabs,
  onSearch,
  onOpen,
  onAddShortcut,
  onRemoveShortcut,
  onReopenClosed,
}) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", url: "" });

  const suggestions = useMemo(() => {
    const lower = value.trim().toLowerCase();

    if (!lower) return [];

    return [
      ...shortcuts.map((item) => ({ ...item, kind: "site" })),
      ...bookmarks.map((item) => ({ name: item.title, url: item.url, kind: "bookmark" })),
      ...(privateTab
        ? []
        : history
            .filter((item) => !item.url.startsWith("fades://"))
            .slice(0, 40)
            .map((item) => ({ name: item.title, url: item.url, kind: "history" }))),
    ]
      .filter(
        (item, index, list) =>
          list.findIndex((other) => other.url === item.url) === index &&
          (item.name.toLowerCase().includes(lower) ||
            item.url.toLowerCase().includes(lower))
      )
      .slice(0, 5);
  }, [value, shortcuts, bookmarks, history, privateTab]);

  const mostVisited = useMemo(
    () =>
      privateTab
        ? []
        : history
            .filter((item) => isNativeUrl(item.url))
            .sort((a, b) => (b.visits || 1) - (a.visits || 1))
            .slice(0, 6),
    [history, privateTab]
  );

  const submitSearch = (event) => {
    event.preventDefault();

    const clean = value.trim();

    if (clean) onSearch(clean);
  };

  const submitShortcut = (event) => {
    event.preventDefault();

    if (onAddShortcut(draft.name, draft.url)) {
      setDraft({ name: "", url: "" });
      setAdding(false);
    }
  };

  return (
    <div className={`new-tab-page ${privateTab ? "private-new-tab" : ""}`}>
      <div className="new-tab-background">
        <div className="grid-lines" />
        <div className="orb orb-one" />
        <div className="orb orb-two" />
        <div className="orb orb-three" />

        <div className="background-logo">
          <img src={FADES_LOGO} alt="" draggable={false} />
        </div>
      </div>

      <div className="new-tab-inner">
        <div className="new-tab-top">
          <div className="brand-large">
            <img src={FADES_LOGO} alt="Fades" className="brand-mark-image" draggable={false} />

            <span>Fades</span>

            {privateTab && <span className="private-pill">Private</span>}
          </div>

          {settings.showClock && <div className="new-tab-clock">{clock}</div>}
        </div>

        <section className="welcome">
          <p className="eyebrow">
            {privateTab ? "PRIVATE BROWSING" : getGreeting().toUpperCase()}
          </p>

          <h1>
            {privateTab ? "Browse " : "Browse the"}
            <span>{privateTab ? " privately." : " web differently."}</span>
          </h1>

          <p className="welcome-description">
            {privateTab
              ? "Pages you visit here won't be saved to history."
              : "Fast, modern, and built around Fades."}
          </p>
        </section>

        <form className="new-tab-search" onSubmit={submitSearch}>
          <span className="search-icon">⌕</span>

          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder={`Search with ${
              SEARCH_ENGINES[settings.engine]?.name || "Fades"
            } or enter a URL`}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoFocus
          />

          <button type="submit">Search</button>

          {open && suggestions.length > 0 && (
            <div className="search-suggestions">
              {suggestions.map((item) => (
                <button
                  type="button"
                  key={item.url}
                  onMouseDown={() => onOpen(item.url)}
                >
                  <span>{item.kind === "bookmark" ? "★" : item.kind === "history" ? "◷" : "◉"}</span>

                  <strong>{item.name}</strong>

                  <small>{item.url}</small>
                </button>
              ))}
            </div>
          )}
        </form>

        <section className="quick-section">
          <div className="section-heading">
            <span>Quick access</span>

            <small>
              {shortcuts.length} shortcut{shortcuts.length === 1 ? "" : "s"}
            </small>
          </div>

          <div className="quick-grid">
            {shortcuts.map((item) => (
              <div key={item.url} className="quick-card-wrap">
                <button className="quick-card" onClick={() => onOpen(item.url)}>
                  <span className="quick-icon">
                    <SiteIcon url={item.url} fallback="◉" />
                  </span>

                  <span>{item.name}</span>
                </button>

                <button
                  className="quick-remove"
                  title="Remove shortcut"
                  onClick={() => onRemoveShortcut(item.url)}
                >
                  ×
                </button>
              </div>
            ))}

            <button className="quick-card quick-add" onClick={() => setAdding((v) => !v)}>
              <span className="quick-icon">＋</span>

              <span>Add shortcut</span>
            </button>
          </div>

          {adding && (
            <form className="add-shortcut-form" onSubmit={submitShortcut}>
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Name"
                spellCheck={false}
              />

              <input
                value={draft.url}
                onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                placeholder="example.com"
                spellCheck={false}
                autoFocus
              />

              <button type="submit" className="primary-button">
                Add
              </button>
            </form>
          )}
        </section>

        {mostVisited.length > 0 && (
          <section className="quick-section">
            <div className="section-heading">
              <span>Most visited</span>
            </div>

            <div className="most-visited">
              {mostVisited.map((item) => (
                <button key={item.url} className="most-visited-item" onClick={() => onOpen(item.url)}>
                  <SiteIcon url={item.url} fallback="◉" />

                  <span>
                    <strong>{item.title}</strong>

                    <small>{formatDisplayUrl(item.url)}</small>
                  </span>

                  <b>{item.visits || 1}×</b>
                </button>
              ))}
            </div>
          </section>
        )}

        {closedTabs.length > 0 && (
          <section className="quick-section">
            <div className="section-heading">
              <span>Recently closed</span>
            </div>

            <div className="recent-closed">
              {closedTabs.slice(0, 4).map((item, index) => (
                <button key={`${item.url}-${item.closedAt}`} onClick={() => onReopenClosed(index)}>
                  <span>↺</span>

                  {item.title}
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="privacy-card">
          <div className="privacy-icon">◈</div>

          <div>
            <strong>{privateTab ? "Private tab" : "Built for your browser."}</strong>

            <span>
              {privateTab
                ? "History and site data from this tab aren't kept after you close it."
                : "Fades keeps browser preferences and local browser data on your device."}
            </span>
          </div>

          <span className="privacy-status">{privateTab ? "Private" : "Local"}</span>
        </div>
      </div>
    </div>
  );
}

/*
 * =========================================================
 * FADES SEARCH (All / Images / Videos / News / Shopping)
 * =========================================================
 */

function FadesSearchPage({
  query,
  type = "all",
  time = "any",
  reloadKey = "",
  safeSearch = true,
  onSearch,
  onOpenResult,
}) {
  const [searchInput, setSearchInput] = useState(query || "");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [meta, setMeta] = useState({});
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [toolsOpen, setToolsOpen] = useState(false);

  useEffect(() => {
    setSearchInput(query || "");
  }, [query]);

  const runSearch = useCallback(
    async (pageNumber, append, signal) => {
      const cleanQuery = String(query || "").trim();

      if (!cleanQuery) return;

      const params = new URLSearchParams({ q: cleanQuery });

      if (type !== "all") params.set("type", type);
      if (time !== "any") params.set("time", time);
      if (safeSearch) params.set("safe", "1");
      if (pageNumber > 1) params.set("page", String(pageNumber));

      const response = await fetch(`${FADES_SEARCH_API}?${params.toString()}`, {
        method: "GET",
        credentials: "include",
        signal,
        headers: { Accept: "application/json" },
      });

      if (!response.ok) throw new Error(`Search failed (${response.status})`);

      const data = await response.json();
      const normalized = extractIncoming(data, type)
        .map((item) => normalizeSearchResult(item, type))
        .filter((item) =>
          type === "images" ? item.thumbnail || item.image : item.url
        );

      setResults((current) => {
        if (!append) return normalized;

        const seen = new Set(current.map((item) => item.url + item.thumbnail));

        return [
          ...current,
          ...normalized.filter((item) => !seen.has(item.url + item.thumbnail)),
        ];
      });

      setPage(pageNumber);
      const explicitMore =
        data && !Array.isArray(data)
          ? data.hasMore ?? data.has_more ?? data.nextPage
          : undefined;

      setHasMore(
        explicitMore !== undefined ? Boolean(explicitMore) : normalized.length >= 10
      );

      if (!append && data && !Array.isArray(data)) {
        const related = (data.related || data.relatedSearches || [])
          .map((item) => (typeof item === "string" ? item : item.query || item.text || item.title))
          .filter(Boolean)
          .slice(0, 8);

        setMeta({
          total: data.total,
          took: data.took,
          correction: toText(data.correction || data.didYouMean),
          related,
          answer: data.answer || null,
          infobox: data.infobox || null,
        });
      } else if (!append) {
        setMeta({});
      }
    },
    [query, type, time, safeSearch]
  );

  useEffect(() => {
    const controller = new AbortController();
    const cleanQuery = String(query || "").trim();

    setSelectedIndex(null);
    setResults([]);
    setMeta({});
    setError("");
    setHasMore(false);
    setPage(1);

    if (!cleanQuery) {
      setSearched(false);
      setLoading(false);

      return;
    }

    setSearched(true);
    setLoading(true);

    runSearch(1, false, controller.signal)
      .catch((searchError) => {
        if (searchError.name === "AbortError") return;

        console.error("[Fades Browser] Search failed:", searchError);
        setError("Fades Search could not reach the search service.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [runSearch, reloadKey]);

  const loadMore = async () => {
    setLoadingMore(true);

    try {
      await runSearch(page + 1, true);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (selectedIndex === null) return;

    const onKey = (event) => {
      if (event.key === "Escape") setSelectedIndex(null);
      else if (event.key === "ArrowRight") {
        setSelectedIndex((index) => Math.min(index + 1, results.length - 1));
      } else if (event.key === "ArrowLeft") {
        setSelectedIndex((index) => Math.max(index - 1, 0));
      }
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIndex, results.length]);

  const submitSearch = (event) => {
    event.preventDefault();

    const clean = searchInput.trim();

    if (clean) onSearch(clean, { type, time });
  };

  const changeType = (nextType) => {
    if (nextType !== type && query) onSearch(query, { type: nextType, time });
  };

  const changeTime = (nextTime) => {
    if (nextTime !== time && query) onSearch(query, { type, time: nextTime });
  };

  const openProps = (result) => ({
    onClick: (event) =>
      onOpenResult(result.url, result.title, { newTab: event.ctrlKey || event.metaKey }),
    onAuxClick: (event) => {
      if (event.button === 1) {
        event.preventDefault();
        onOpenResult(result.url, result.title, { newTab: true });
      }
    },
  });

  const sourceLine = (result) => [result.source, result.date].filter(Boolean).join(" · ");

  const renderResults = () => {
    if (type === "images") {
      return (
        <div className="fades-image-grid">
          {results.map((result, index) => (
            <button
              key={`${result.thumbnail}-${index}`}
              className="fades-image-card"
              onClick={() => setSelectedIndex(index)}
              title={result.title}
            >
              <img
                src={result.thumbnail || result.image}
                alt={result.title}
                loading="lazy"
                draggable={false}
                onError={(event) => {
                  event.currentTarget.closest(".fades-image-card").style.display = "none";
                }}
              />

              <span className="image-card-caption">
                <strong>{result.title}</strong>

                <small>{formatDisplayUrl(result.displayUrl || result.url)}</small>
              </span>
            </button>
          ))}
        </div>
      );
    }

    if (type === "videos") {
      return (
        <div className="fades-video-grid">
          {results.map((result, index) => (
            <button key={`${result.url}-${index}`} className="fades-video-card" {...openProps(result)}>
              <span className="video-thumb">
                {result.thumbnail && (
                  <img
                    src={result.thumbnail}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    onError={(event) => {
                      event.currentTarget.style.display = "none";
                    }}
                  />
                )}

                <span className="video-play">▶</span>

                {result.duration && <span className="video-duration">{result.duration}</span>}
              </span>

              <span className="video-info">
                <strong>{result.title}</strong>

                <small>
                  {[result.source, result.views, result.date].filter(Boolean).join(" · ") ||
                    formatDisplayUrl(result.displayUrl || result.url)}
                </small>
              </span>
            </button>
          ))}
        </div>
      );
    }

    if (type === "shopping") {
      return (
        <div className="fades-shop-grid">
          {results.map((result, index) => (
            <button key={`${result.url}-${index}`} className="fades-shop-card" {...openProps(result)}>
              <span className="shop-thumb">
                <img
                  src={result.thumbnail || FADES_LOGO}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  onError={(event) => {
                    event.currentTarget.src = FADES_LOGO;
                  }}
                />
              </span>

              <span className="shop-info">
                {result.price && <b className="shop-price">{result.price}</b>}

                <strong>{result.title}</strong>

                <small>
                  {result.source || formatDisplayUrl(result.displayUrl || result.url)}
                </small>
              </span>
            </button>
          ))}
        </div>
      );
    }

    if (type === "news") {
      return (
        <div className="fades-news-list">
          {results.map((result, index) => (
            <button key={`${result.url}-${index}`} className="fades-news-card" {...openProps(result)}>
              <span className="news-body">
                <span className="news-source">
                  {result.favicon && (
                    <img
                      src={result.favicon}
                      alt=""
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                  )}

                  {sourceLine(result) || formatDisplayUrl(result.displayUrl || result.url)}
                </span>

                <span className="news-title">{result.title}</span>

                {result.description && (
                  <span className="news-description">{result.description}</span>
                )}
              </span>

              {result.thumbnail && (
                <span className="news-thumb">
                  <img
                    src={result.thumbnail}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    onError={(event) => {
                      event.currentTarget.parentElement.style.display = "none";
                    }}
                  />
                </span>
              )}
            </button>
          ))}
        </div>
      );
    }

    return (
      <div className="fades-results-list">
        {results.map((result, index) => (
          <button key={`${result.url}-${index}`} className="fades-result" {...openProps(result)}>
            <div className="result-top">
              <div className="result-favicon">
                {result.favicon ? (
                  <img
                    src={result.favicon}
                    alt=""
                    onError={(event) => {
                      event.currentTarget.style.display = "none";
                    }}
                  />
                ) : (
                  <SiteIcon url={result.url} fallback="◉" />
                )}
              </div>

              <div className="result-site">
                {formatDisplayUrl(result.displayUrl || result.url)}
              </div>
            </div>

            <div className="result-title">{result.title}</div>

            {result.description && (
              <div className="result-description">{result.description}</div>
            )}
          </button>
        ))}
      </div>
    );
  };

  const selected = selectedIndex !== null ? results[selectedIndex] : null;

  return (
    <div className={`fades-search-page search-type-${type}`}>
      <div className="fades-search-background">
        <div className="search-grid" />
        <div className="search-glow search-glow-one" />
        <div className="search-glow search-glow-two" />

        <img src={FADES_LOGO} alt="" className="search-background-logo" draggable={false} />
      </div>

      <div className="fades-search-inner">
        <header className="fades-search-header">
          <div className="fades-search-brand">
            <img src={FADES_LOGO} alt="Fades" className="fades-search-logo" draggable={false} />

            <div>
              <strong>Fades</strong>
              <span>Search</span>
            </div>
          </div>

          <form className="fades-results-search" onSubmit={submitSearch}>
            <span>⌕</span>

            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search the web"
              spellCheck={false}
              autoFocus
            />

            {searchInput && (
              <button
                type="button"
                className="search-clear"
                onClick={() => setSearchInput("")}
                title="Clear"
              >
                ×
              </button>
            )}

            <button type="submit">Search</button>
          </form>
        </header>

        <nav className="fades-search-tabs" aria-label="Search type">
          {SEARCH_TABS.map((tab) => (
            <button
              key={tab.id}
              className={`search-tab ${tab.id === type ? "active" : ""}`}
              onClick={() => changeType(tab.id)}
              aria-current={tab.id === type ? "page" : undefined}
            >
              <span className="search-tab-icon">{tab.icon}</span>

              {tab.label}
            </button>
          ))}

          <button
            className={`search-tab search-tools-toggle ${
              toolsOpen || time !== "any" ? "active-tools" : ""
            }`}
            onClick={() => setToolsOpen((open) => !open)}
          >
            Tools {toolsOpen ? "▴" : "▾"}
          </button>
        </nav>

        {(toolsOpen || time !== "any") && (
          <div className="search-tools">
            <span className="search-tools-label">Time</span>

            {TIME_FILTERS.map((item) => (
              <button
                key={item.id}
                className={`time-filter ${item.id === time ? "active" : ""}`}
                onClick={() => changeTime(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}

        <div className="fades-search-content">
          <div className="fades-search-meta">
            <span>
              {loading
                ? "Searching the web..."
                : results.length > 0
                ? `${meta.total ? `About ${Number(meta.total).toLocaleString()}` : results.length} ${TYPE_NOUN[type]}${
                    meta.took ? ` (${meta.took}s)` : ""
                  }`
                : searched
                ? "No results"
                : "Search the web with Fades"}
            </span>

            {query && <span className="search-query-label">“{query}”</span>}
          </div>

          {!loading && meta.correction && (
            <div className="search-correction">
              Showing results for{" "}
              <button onClick={() => onSearch(meta.correction, { type, time })}>
                {meta.correction}
              </button>
            </div>
          )}

          {!loading && type === "all" && meta.answer && (
            <div className="search-answer">
              {meta.answer.title && <strong>{toText(meta.answer.title)}</strong>}

              <p>{toText(meta.answer.text || meta.answer.answer || meta.answer)}</p>

              {meta.answer.url && (
                <button onClick={() => onOpenResult(meta.answer.url, toText(meta.answer.title))}>
                  {formatDisplayUrl(meta.answer.url)}
                </button>
              )}
            </div>
          )}

          {!loading && type === "all" && meta.infobox && (
            <div className="search-infobox">
              {meta.infobox.image && (
                <img src={meta.infobox.image} alt="" draggable={false} />
              )}

              <div>
                <strong>{toText(meta.infobox.title)}</strong>

                {meta.infobox.description && <p>{toText(meta.infobox.description)}</p>}

                {Array.isArray(meta.infobox.facts) && (
                  <dl>
                    {meta.infobox.facts.slice(0, 6).map((fact, index) => (
                      <div key={index}>
                        <dt>{toText(fact.label)}</dt>
                        <dd>{toText(fact.value)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            </div>
          )}

          {loading && (
            <div className="fades-search-loading">
              <div className="search-loading-ring" />

              <strong>Fades is searching</strong>

              <span>
                Finding {type === "all" ? "results" : TYPE_NOUN[type]} for "{query}"
              </span>
            </div>
          )}

          {!loading && error && (
            <div className="fades-search-error">
              <div className="search-error-icon">!</div>

              <div>
                <strong>Search unavailable</strong>

                <span>{error}</span>
              </div>
            </div>
          )}

          {!loading && !error && results.length === 0 && searched && (
            <div className="fades-search-empty">
              <img src={FADES_LOGO} alt="" className="empty-search-logo" draggable={false} />

              <h2>No {TYPE_NOUN[type]} found</h2>

              <p>Try another search phrase, a different tab, or check your spelling.</p>
            </div>
          )}

          {!loading && !error && results.length > 0 && renderResults()}

          {!loading && !error && hasMore && (
            <button className="load-more" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? "Loading…" : "More results"}
            </button>
          )}

          {!loading && meta.related && meta.related.length > 0 && (
            <div className="search-related">
              <span>Related searches</span>

              <div>
                {meta.related.map((item) => (
                  <button key={item} className="related-chip" onClick={() => onSearch(item, { type })}>
                    ⌕ {item}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <footer className="fades-search-footer">
          <span>Fades Search{safeSearch ? " · SafeSearch on" : ""}</span>

          <span>Powered by Fades</span>
        </footer>
      </div>

      {selected && (
        <ImageLightbox
          image={selected}
          index={selectedIndex}
          total={results.length}
          onClose={() => setSelectedIndex(null)}
          onPrev={() => setSelectedIndex((i) => Math.max(i - 1, 0))}
          onNext={() => setSelectedIndex((i) => Math.min(i + 1, results.length - 1))}
          onVisit={() => {
            onOpenResult(selected.url, selected.title);
            setSelectedIndex(null);
          }}
          onOpenImage={() => {
            onOpenResult(selected.image || selected.thumbnail, selected.title);
            setSelectedIndex(null);
          }}
        />
      )}
    </div>
  );
}

function ImageLightbox({ image, index, total, onClose, onPrev, onNext, onVisit, onOpenImage }) {
  return (
    <div className="image-lightbox" onClick={onClose}>
      <div className="lightbox-panel" onClick={(event) => event.stopPropagation()}>
        <button className="lightbox-close" onClick={onClose} aria-label="Close preview">
          ×
        </button>

        <div className="lightbox-stage">
          <button
            className="lightbox-nav prev"
            onClick={onPrev}
            disabled={index === 0}
            aria-label="Previous image"
          >
            ‹
          </button>

          <img
            src={image.image || image.thumbnail}
            alt={image.title}
            draggable={false}
            onError={(event) => {
              if (image.thumbnail && event.currentTarget.src !== image.thumbnail) {
                event.currentTarget.src = image.thumbnail;
              }
            }}
          />

          <button
            className="lightbox-nav next"
            onClick={onNext}
            disabled={index === total - 1}
            aria-label="Next image"
          >
            ›
          </button>
        </div>

        <div className="lightbox-info">
          <strong>{image.title}</strong>

          <small>
            {formatDisplayUrl(image.displayUrl || image.url)} · {index + 1} / {total}
          </small>

          <div className="lightbox-actions">
            <button className="primary-button" onClick={onVisit}>
              Visit page
            </button>

            <button className="lightbox-secondary" onClick={onOpenImage}>
              Open image
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/*
 * =========================================================
 * SIDEBAR PANELS
 * =========================================================
 */

function MenuButton({ icon, label, shortcut, onClick, disabled }) {
  return (
    <button className="menu-item" onClick={onClick} disabled={disabled}>
      <span className="menu-item-icon">{icon}</span>

      <span className="menu-item-label">{label}</span>

      {shortcut ? <span className="menu-shortcut">{shortcut}</span> : <span className="menu-arrow">›</span>}
    </button>
  );
}

function Menu({ zoom, canReopen, onOpen, actions, onClose }) {
  const run = (fn) => () => {
    fn();
    onClose();
  };

  return (
    <div className="menu-panel">
      <div className="menu-account">
        <div className="menu-avatar-image">
          <img src={FADES_LOGO} alt="Fades" draggable={false} />
        </div>

        <div>
          <strong>Fades Account</strong>

          <span>Sync your browser</span>
        </div>

        <button onClick={() => onOpen("account")}>→</button>
      </div>

      <div className="menu-section">
        <MenuButton icon="＋" label="New tab" shortcut="Ctrl+T" onClick={run(actions.newTab)} />
        <MenuButton icon="◌" label="New private tab" shortcut="Ctrl+Shift+N" onClick={run(actions.privateTab)} />
        <MenuButton icon="▣" label="Duplicate tab" onClick={run(actions.duplicate)} />
        <MenuButton
          icon="↺"
          label="Reopen closed tab"
          shortcut="Ctrl+Shift+T"
          onClick={run(actions.reopen)}
          disabled={!canReopen}
        />
      </div>

      <div className="menu-section">
        <div className="menu-zoom">
          <span className="menu-item-icon">⌕</span>

          <span className="menu-item-label">Zoom</span>

          <div className="zoom-controls">
            <button onClick={() => actions.zoom(-1)}>−</button>

            <span>{Math.round(zoom * 100)}%</span>

            <button onClick={() => actions.zoom(1)}>+</button>

            <button onClick={actions.fullscreen} title="Full screen (F11)">
              ⛶
            </button>
          </div>
        </div>

        <MenuButton icon="⌖" label="Find in page" shortcut="Ctrl+F" onClick={run(actions.find)} />
        <MenuButton icon="⎙" label="Print" shortcut="Ctrl+P" onClick={run(actions.print)} />
        <MenuButton icon="⧉" label="Copy link" onClick={run(actions.copyLink)} />
      </div>

      <div className="menu-section">
        <MenuButton icon="★" label="Bookmarks" shortcut="Ctrl+Shift+O" onClick={() => onOpen("bookmarks")} />
        <MenuButton icon="◷" label="History" shortcut="Ctrl+H" onClick={() => onOpen("history")} />
        <MenuButton icon="↓" label="Downloads" shortcut="Ctrl+J" onClick={() => onOpen("downloads")} />
        <MenuButton icon="▤" label="Tabs" onClick={() => onOpen("tabs")} />
      </div>

      <div className="menu-section">
        <MenuButton icon="⚙" label="Settings" shortcut="Ctrl+," onClick={() => onOpen("settings")} />
        <MenuButton icon="⌨" label="Keyboard shortcuts" onClick={() => onOpen("shortcuts")} />
        <MenuButton icon="?" label="Help" onClick={run(actions.help)} />
      </div>

      <div className="menu-version">
        <span>Fades Browser</span>

        <span>v{APP_VERSION}</span>
      </div>
    </div>
  );
}

function BookmarkPanel({ bookmarks, onOpen, onDelete, onRename, onExport, onImport }) {
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState(null);
  const [editValue, setEditValue] = useState("");
  const fileRef = useRef(null);

  const visible = bookmarks.filter(
    (item) =>
      item.title.toLowerCase().includes(filter.toLowerCase()) ||
      item.url.toLowerCase().includes(filter.toLowerCase())
  );

  const commit = () => {
    if (editing && editValue.trim()) onRename(editing, editValue.trim());

    setEditing(null);
  };

  return (
    <>
      <div className="panel-toolbar">
        <input
          className="panel-search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Search bookmarks"
          spellCheck={false}
        />

        <button onClick={onExport} title="Export backup">
          ⤓
        </button>

        <button onClick={() => fileRef.current?.click()} title="Import backup">
          ⤒
        </button>

        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          hidden
          onChange={(event) => {
            onImport(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>

      {bookmarks.length === 0 ? (
        <div className="empty-panel">
          <div className="empty-icon">★</div>

          <h3>No bookmarks yet</h3>

          <p>Bookmark a page by clicking the star in the address bar.</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-panel">
          <p>No bookmarks match "{filter}".</p>
        </div>
      ) : (
        <div className="panel-list">
          {visible.map((bookmark) => (
            <div className="panel-list-item" key={bookmark.url}>
              {editing === bookmark.url ? (
                <input
                  className="bookmark-edit"
                  value={editValue}
                  autoFocus
                  onChange={(event) => setEditValue(event.target.value)}
                  onBlur={commit}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commit();
                    if (event.key === "Escape") setEditing(null);
                  }}
                />
              ) : (
                <button
                  className="panel-item-main"
                  onClick={(event) =>
                    onOpen(bookmark, { newTab: event.ctrlKey || event.metaKey })
                  }
                >
                  <span className="panel-item-icon">
                    <SiteIcon url={bookmark.url} fallback="★" />
                  </span>

                  <span>
                    <strong>{bookmark.title}</strong>

                    <small>{bookmark.url}</small>
                  </span>
                </button>
              )}

              <button
                className="panel-delete"
                title="Rename"
                onClick={() => {
                  setEditing(bookmark.url);
                  setEditValue(bookmark.title);
                }}
              >
                ✎
              </button>

              <button className="panel-delete" title="Delete" onClick={() => onDelete(bookmark.url)}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function HistoryPanel({ history, onOpen, onDelete, onClear }) {
  const [filter, setFilter] = useState("");

  const visible = history.filter(
    (item) =>
      item.title.toLowerCase().includes(filter.toLowerCase()) ||
      item.url.toLowerCase().includes(filter.toLowerCase())
  );

  const groups = [];

  visible.forEach((item) => {
    const label = dayLabel(item.visitedAt);
    const last = groups[groups.length - 1];

    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  });

  if (history.length === 0) {
    return (
      <div className="empty-panel">
        <div className="empty-icon">◷</div>

        <h3>No history</h3>

        <p>Your recently visited pages will appear here.</p>
      </div>
    );
  }

  return (
    <>
      <div className="panel-toolbar">
        <input
          className="panel-search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Search history"
          spellCheck={false}
        />
      </div>

      <div className="panel-action">
        <button onClick={onClear}>Clear browsing history</button>
      </div>

      <div className="panel-list">
        {groups.map((group) => (
          <div key={group.label}>
            <div className="history-day">{group.label}</div>

            {group.items.map((item) => (
              <div className="panel-list-item" key={item.url}>
                <button
                  className="history-item"
                  onClick={(event) =>
                    onOpen(item.url, { newTab: event.ctrlKey || event.metaKey })
                  }
                >
                  <span className="history-time">
                    {new Date(item.visitedAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {item.visits > 1 ? ` · ${item.visits} visits` : ""}
                  </span>

                  <strong>{item.title}</strong>

                  <small>{item.url}</small>
                </button>

                <button className="panel-delete" title="Remove" onClick={() => onDelete(item.url)}>
                  ×
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

function DownloadFlyout({ downloads, top, onMouseEnter, onShowAll, onNotify }) {
  const recent = downloads.slice(0, 4);

  const open = async (path) => {
    if (!path || !(await openDownloadedFile(path))) onNotify("Couldn't open the file");
  };

  const reveal = async (path) => {
    if (!path || !(await revealDownloadedFile(path))) onNotify("Couldn't open the folder");
  };

  return (
    <div className="download-flyout" style={{ top }} onMouseEnter={onMouseEnter}>
      <div className="download-flyout-title">Downloads</div>

      {recent.length === 0 && <div className="download-flyout-empty">No downloads yet</div>}

      {recent.map((item) => (
        <div className={`download-flyout-item ${item.status}`} key={item.id}>
          <span className="download-flyout-icon">
            {item.status === "failed" ? "!" : item.status === "done" ? "✓" : "↓"}
          </span>

          <div className="download-flyout-main">
            <strong title={item.name}>{item.name}</strong>

            {item.status === "downloading" ? (
              <>
                <small>Downloading…</small>
                <span className="download-bar"><i /></span>
              </>
            ) : item.status === "failed" ? (
              <small>Download failed</small>
            ) : (
              <small>{formatDisplayUrl(item.url)}</small>
            )}
          </div>

          {item.status === "done" && (
            <div className="download-flyout-actions">
              <button onClick={() => open(item.path)}>Open</button>
              <button onClick={() => reveal(item.path)} title="Show in folder">⌕</button>
            </div>
          )}
        </div>
      ))}

      <button className="download-flyout-all" onClick={onShowAll}>
        Show all downloads
      </button>
    </div>
  );
}

function DownloadPanel({ downloads, onClear }) {
  if (!downloads.length) {
    return (
      <div className="empty-panel">
        <div className="empty-icon">↓</div>

        <h3>No downloads</h3>

        <p>Downloaded files will appear here when download tracking is enabled.</p>
      </div>
    );
  }

  return (
    <>
      <div className="panel-action">
        <button onClick={onClear}>Clear download history</button>
      </div>

      <div className="panel-list">
        {downloads.map((download) => (
          <div className="panel-list-item" key={download.id}>
            <div className="panel-item-main">
              <span className="panel-item-icon">↓</span>

              <span>
                <strong>{download.name}</strong>

                <small>{download.url}</small>
              </span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function TabsPanel({ tabs, activeTab, onSwitch, onClose, onNew }) {
  const [filter, setFilter] = useState("");

  const visible = tabs.filter(
    (tab) =>
      tab.title.toLowerCase().includes(filter.toLowerCase()) ||
      tab.url.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <>
      <div className="panel-toolbar">
        <input
          className="panel-search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={`Search ${tabs.length} tab${tabs.length === 1 ? "" : "s"}`}
          spellCheck={false}
        />

        <button onClick={onNew} title="New tab">
          ＋
        </button>
      </div>

      <div className="panel-list">
        {visible.map((tab) => (
          <div className={`panel-list-item ${tab.id === activeTab ? "current" : ""}`} key={tab.id}>
            <button className="panel-item-main" onClick={() => onSwitch(tab.id)}>
              <span className="panel-item-icon">
                {tab.private ? "◌" : tab.pinned ? "📌" : <SiteIcon url={tab.url} fallback="◉" />}
              </span>

              <span>
                <strong>{tab.title}</strong>

                <small>{tab.url === NEW_TAB_URL ? "New tab" : tab.url}</small>
              </span>
            </button>

            <button className="panel-delete" title="Close tab" onClick={(event) => onClose(tab.id, event)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

function AccountPanel({
  account,
  pending,
  autoSync,
  onToggleAutoSync,
  onSignIn,
  onCancelSignIn,
  onSignOut,
  onRefresh,
  onSync,
  onBackup,
  onDeleteCloud,
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const signedIn = account.status === "signedIn";

  return (
    <div className="account-panel">
      <div className="account-large-avatar-image">
        <img src={FADES_LOGO} alt="Fades" draggable={false} />
      </div>

      <h2>
        {signedIn
          ? account.user?.username || account.user?.name || "Fades Account"
          : "Fades Account"}
      </h2>

      <p>
        {signedIn
          ? account.user?.email || "Your browser data can sync across devices."
          : "Sign in to sync bookmarks, history, shortcuts and tabs across devices."}
      </p>

      {account.status === "unknown" && <p>Checking your session…</p>}

      {account.status === "error" && (
        <>
          <p className="account-error">{account.message}</p>

          <button className="primary-button" onClick={onRefresh}>
            Try again
          </button>
        </>
      )}

      {account.status === "signedOut" &&
        (pending ? (
          <>
            <div className="signin-code">
              <small>Confirm this code on the sign-in page</small>

              <strong>{pending.userCode}</strong>
            </div>

            <p>Waiting for you to sign in in the new tab…</p>

            <button className="ghost-button" onClick={onCancelSignIn}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button className="primary-button" onClick={onSignIn}>
              Sign in to Fades
            </button>

            <button className="ghost-button" onClick={onRefresh}>
              I've signed in – refresh
            </button>
          </>
        ))}

      {signedIn && (
        <div className="sync-actions">
          <button
            className="primary-button"
            onClick={onSync}
            disabled={account.syncing}
          >
            {account.syncing ? "Syncing…" : "Sync now"}
          </button>

          <button
            className="ghost-button"
            onClick={onBackup}
            disabled={account.syncing}
          >
            Back up this browser
          </button>

          <SettingToggle
            title="Auto-sync"
            description="Back up changes a few seconds after you make them"
            checked={autoSync}
            onChange={onToggleAutoSync}
          />

          {confirmDelete ? (
            <button
              className="danger-button"
              onClick={() => {
                onDeleteCloud();
                setConfirmDelete(false);
              }}
            >
              Click again to delete all cloud data
            </button>
          ) : (
            <button
              className="ghost-button danger"
              onClick={() => setConfirmDelete(true)}
            >
              Delete cloud data
            </button>
          )}

          <button className="ghost-button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      )}

      {account.message && account.status !== "error" && (
        <p className="account-message">
          {account.message}
          {account.lastSync
            ? ` · ${new Date(account.lastSync).toLocaleTimeString()}`
            : ""}
        </p>
      )}

      <div className="account-features">
        {["Bookmarks sync", "History sync", "Shortcuts & settings", "Open tabs"].map(
          (label) => (
            <div key={label}>
              <span>✓</span>

              <p>{label}</p>
            </div>
          )
        )}
      </div>
    </div>
  );
}
function SettingToggle({ title, description, checked, onChange }) {
  return (
    <button className="setting-row" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
      <span>
        <strong>{title}</strong>

        {description && <small>{description}</small>}
      </span>

      <span className={`switch ${checked ? "on" : ""}`}>
        <i />
      </span>
    </button>
  );
}

function SettingSegmented({ title, description, value, options, onChange }) {
  return (
    <div className="setting-block">
      <span>
        <strong>{title}</strong>

        {description && <small>{description}</small>}
      </span>

      <div className="segmented">
        {options.map((option) => (
          <button
            key={option.value}
            className={String(value) === String(option.value) ? "active" : ""}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SettingsPanel({
  settings,
  onChange,
  onOpenPanel,
  onClearHistory,
  onClearAll,
  onExport,
  onImport,
}) {
  const [confirmClear, setConfirmClear] = useState(false);
  const fileRef = useRef(null);

  return (
    <div className="settings-panel">
      <div className="settings-section-title">Appearance</div>

      <SettingSegmented
        title="Theme"
        value={settings.theme}
        onChange={(value) => onChange("theme", value)}
        options={[
          { value: "dark", label: "Dark" },
          { value: "light", label: "Light" },
          { value: "system", label: "System" },
        ]}
      />

      <div className="setting-block">
        <span>
          <strong>Accent color</strong>
        </span>

        <div className="swatches">
          {ACCENTS.map((color) => (
            <button
              key={color}
              className={`swatch ${settings.accent === color ? "active" : ""}`}
              style={{ background: color }}
              onClick={() => onChange("accent", color)}
              aria-label={`Accent ${color}`}
            />
          ))}
        </div>
      </div>

      <SettingToggle
        title="Bookmarks bar"
        description="Show your bookmarks below the address bar"
        checked={settings.showBookmarksBar}
        onChange={(value) => onChange("showBookmarksBar", value)}
      />

      <SettingToggle
        title="Home button"
        checked={settings.showHomeButton}
        onChange={(value) => onChange("showHomeButton", value)}
      />

      <SettingToggle
        title="Site icons"
        description="Show website icons on tabs and bookmarks"
        checked={settings.showSiteIcons}
        onChange={(value) => onChange("showSiteIcons", value)}
      />

      <SettingToggle
        title="Clock on new tab"
        checked={settings.showClock}
        onChange={(value) => onChange("showClock", value)}
      />

      <div className="settings-section-title">Search</div>

      <SettingSegmented
        title="Default search engine"
        description="Used for the address bar and new tab"
        value={settings.engine}
        onChange={(value) => onChange("engine", value)}
        options={Object.entries(SEARCH_ENGINES).map(([value, engine]) => ({
          value,
          label: engine.name,
        }))}
      />

      <SettingToggle
        title="Search suggestions"
        description="Show suggestions while you type"
        checked={settings.searchSuggestions}
        onChange={(value) => onChange("searchSuggestions", value)}
      />

      <SettingToggle
        title="SafeSearch"
        description="Filter explicit results in Fades Search"
        checked={settings.safeSearch}
        onChange={(value) => onChange("safeSearch", value)}
      />

      <div className="settings-section-title">On startup</div>

      <SettingSegmented
        title="When Fades Browser opens"
        value={settings.startup}
        onChange={(value) => onChange("startup", value)}
        options={[
          { value: "newtab", label: "New tab" },
          { value: "restore", label: "Last session" },
          { value: "homepage", label: "Homepage" },
        ]}
      />

      <div className="setting-block">
        <span>
          <strong>Homepage</strong>

          <small>Opens with the Home button</small>
        </span>

        <input
          className="setting-input"
          value={settings.homepage}
          onChange={(event) => onChange("homepage", event.target.value)}
          placeholder={NEW_TAB_URL}
          spellCheck={false}
        />
      </div>

      <SettingSegmented
        title="Default page zoom"
        value={settings.defaultZoom}
        onChange={(value) => onChange("defaultZoom", Number(value))}
        options={[0.9, 1, 1.1, 1.25].map((value) => ({
          value,
          label: `${Math.round(value * 100)}%`,
        }))}
      />

      <div className="settings-section-title">Privacy & data</div>

      <button className="setting-row" onClick={onClearHistory}>
        <span>
          <strong>Clear browsing history</strong>

          <small>Removes visited pages and searches</small>
        </span>

        <b>Clear</b>
      </button>

      <button className="setting-row" onClick={onExport}>
        <span>
          <strong>Export data</strong>

          <small>Bookmarks, history, shortcuts and settings</small>
        </span>

        <b>⤓</b>
      </button>

      <button className="setting-row" onClick={() => fileRef.current?.click()}>
        <span>
          <strong>Import data</strong>

          <small>Merge a Fades Browser backup file</small>
        </span>

        <b>⤒</b>
      </button>

      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        hidden
        onChange={(event) => {
          onImport(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      <button
        className="setting-row danger-row"
        onClick={() => {
          if (confirmClear) {
            onClearAll();
            setConfirmClear(false);
          } else {
            setConfirmClear(true);
          }
        }}
      >
        <span>
          <strong>{confirmClear ? "Click again to confirm" : "Reset everything"}</strong>

          <small>Deletes bookmarks, history, shortcuts and settings</small>
        </span>

        <b>{confirmClear ? "Sure?" : "Reset"}</b>
      </button>

      <div className="settings-section-title">Fades Browser</div>

      <button className="setting-row" onClick={() => onOpenPanel("shortcuts")}>
        <span>
          <strong>Keyboard shortcuts</strong>

          <small>View all browser shortcuts</small>
        </span>

        <b>›</b>
      </button>

      <button className="setting-row" onClick={() => onOpenPanel("account")}>
        <span>
          <strong>Account & sync</strong>

          <small>Sign in to sync across devices</small>
        </span>

        <b>›</b>
      </button>

      <div className="setting-row static">
        <span>
          <strong>Version</strong>

          <small>Current browser version</small>
        </span>

        <b>{APP_VERSION}</b>
      </div>
    </div>
  );
}

function ShortcutsPanel() {
  return (
    <div className="shortcuts-panel">
      {KEYBOARD_SHORTCUTS.map(([label, keys]) => (
        <div className="shortcut-row" key={label}>
          <span>{label}</span>

          <kbd>{keys}</kbd>
        </div>
      ))}

      <p className="shortcuts-note">
        Shortcuts work while the browser UI has focus. Click the address bar or
        toolbar first if a website page has captured the keyboard.
      </p>
    </div>
  );
}