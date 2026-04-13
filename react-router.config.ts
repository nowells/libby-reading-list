import type { Config } from "@react-router/dev/config";

export default {
  basename: process.env.BASENAME ?? "/",
  ssr: false,
} satisfies Config;
