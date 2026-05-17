import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { AUTH_SECRET } from "./auth-secret";

type UserRole = "admin" | "client";
type DemoUser = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role?: UserRole;
};

// Demo users — in production replace with a real DB lookup.
// Add more by running: node -e "console.log(require('bcryptjs').hashSync('yourpass', 10))"
// and setting DEMO_USERS in .env.local as JSON.
const FALLBACK_USERS: DemoUser[] = [
  {
    id: "1",
    name: "Demo User",
    email: "demo@inform.app",
    // bcrypt hash of "inform2026"
    passwordHash: "$2b$10$0V/zGnfDZVK6CbvmmNnh1.FgCUYEA.Sj/auAkc9En0yGhzE/mPBRC",
    role: "client",
  },
  {
    id: "2",
    name: "Admin Operator",
    email: "admin@inform.app",
    // bcrypt hash of "inform2026"
    passwordHash: "$2b$10$0V/zGnfDZVK6CbvmmNnh1.FgCUYEA.Sj/auAkc9En0yGhzE/mPBRC",
    role: "admin",
  },
];

function getUsers(): DemoUser[] {
  try {
    const raw = process.env.DEMO_USERS;
    if (raw) return JSON.parse(raw);
  } catch {}
  return FALLBACK_USERS;
}

function getRoleForEmail(email?: string | null, fallback: UserRole = "client"): UserRole {
  if (!email) return fallback;
  const admins = (process.env.ADMIN_EMAILS ?? "admin@inform.app")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.toLowerCase()) ? "admin" : fallback;
}

const providers: NextAuthOptions["providers"] = [];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  );
}

providers.push(
  CredentialsProvider({
    name: "credentials",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      if (!credentials?.email || !credentials?.password) return null;

      // 1. Check hardcoded / env demo users first (fast, no DB round-trip).
      const users = getUsers();
      const demoUser = users.find(
        (u: { email: string }) =>
          u.email.toLowerCase() === credentials.email.toLowerCase(),
      );
      if (demoUser) {
        const valid = await bcrypt.compare(credentials.password, demoUser.passwordHash);
        if (!valid) return null;
        return {
          id: demoUser.id,
          name: demoUser.name,
          email: demoUser.email,
          role: demoUser.role ?? getRoleForEmail(demoUser.email),
        };
      }

      // 2. Fall back to Supabase app_users table (real sign-ups).
      try {
        const { createAdminClient } = await import("@/utils/supabase/admin");
        const supabase = createAdminClient();
        if (!supabase) return null;

        const { data: row } = await supabase
          .from("app_users")
          .select("id, name, email, password_hash, role")
          .eq("email", credentials.email.toLowerCase())
          .maybeSingle();

        if (!row) return null;
        const valid = await bcrypt.compare(credentials.password, row.password_hash);
        if (!valid) return null;

        return {
          id: row.id,
          name: row.name,
          email: row.email,
          role: (row.role as UserRole) ?? getRoleForEmail(row.email),
        };
      } catch {
        return null;
      }
    },
  }),
);

export const authOptions: NextAuthOptions = {
  providers,
  secret: AUTH_SECRET,
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role ?? getRoleForEmail(user.email);
      }
      if (!token.role) token.role = getRoleForEmail(token.email);
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id ?? token.sub;
        session.user.role = token.role ?? "client";
      }
      return session;
    },
  },
};
