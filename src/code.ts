/** 1 to 32 URL-safe characters, except the paths the app serves itself. Shared with the admin UI. */
export const CODE_PATTERN = "^(?!(?:api|admin|about)$)[\\w\\-]{1,32}$";
