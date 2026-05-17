/** @type {import('next').NextConfig} */

// Internal URL of the FastAPI backend, reachable from the Next.js server
// process (not the browser). start.sh passes this; default is localhost.
const backendInternalUrl =
  process.env.BACKEND_INTERNAL_URL ?? "http://127.0.0.1:8000";

const nextConfig = {
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
  // Proxy browser calls to /backend/* to the FastAPI backend server-side.
  // This keeps API calls same-origin so they work through the Cloudflare
  // tunnel and avoid CORS. The frontend uses NEXT_PUBLIC_API_BASE_URL=/backend.
  async rewrites() {
    return [
      {
        source: "/backend/:path*",
        destination: `${backendInternalUrl}/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
