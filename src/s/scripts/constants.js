
// Add this near the top with your other constants
export const PREVIEW_CACHE_KEY = "linkPreviewsCache_v2";
export const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

export const DEFAULT_SERVER_SETTINGS = Object.freeze({
  bad_word_filter_enabled: false,
  admin_only_custom_emojis: false,
  allow_plaintext_links: false,
  allow_everyone_mentions: false
});

export const SERVER_ROLE_LADDER = ["User", "Manager", "Admin", "SysManager", "SysAdmin"];

