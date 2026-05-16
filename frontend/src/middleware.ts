import { withAuth } from "next-auth/middleware";
import { AUTH_SECRET } from "@/lib/auth-secret";

export default withAuth({
  pages: {
    signIn: "/login",
  },
  secret: AUTH_SECRET,
});

export const config = {
  matcher: ["/dashboard/:path*"],
};
