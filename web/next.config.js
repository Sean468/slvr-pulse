/** @type {import('next').NextConfig} */
// Static export: the whole app is client-side (reads via public RPC, writes via
// the user's wallet), so it can be hosted on any static host or CDN.
module.exports = { reactStrictMode: true, output: "export", images: { unoptimized: true } };
