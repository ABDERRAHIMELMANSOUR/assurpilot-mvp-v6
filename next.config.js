/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Vercel serves the app behind its own proxy; the framework header adds
  // nothing and only advertises the stack.
  poweredByHeader: false,
  eslint: {
    dirs: ["src"],
  },
};

module.exports = nextConfig;
