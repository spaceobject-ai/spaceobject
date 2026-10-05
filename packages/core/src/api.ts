// SUN_API_URL reroutes every CLI→API call to a local Worker (`wrangler dev`)
// without touching config files; unset means production.
export const SPACE_OBJECT_API_URL = process.env.SUN_API_URL ?? "https://api.spaceobject.xyz";
