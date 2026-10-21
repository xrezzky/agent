/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Lampiran inline dikirim sebagai bagian body JSON chat.
  // Batas request server action/Route Handler dinaikkan, tetapi upload file besar
  // TIDAK lewat sini (langsung ke object storage via URL presigned).
  experimental: {
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
