import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main-content" className="grid min-h-[100dvh] place-items-center bg-background px-6 text-text-primary">
      <div className="surface-inset max-w-md rounded-xl border border-card-border bg-card p-8 text-center">
        <p className="font-mono text-sm text-ember">404</p>
        <h1 className="mt-3 text-3xl font-black">Page not found</h1>
        <p className="mt-3 text-sm leading-6 text-text-secondary">
          The route does not exist in this prototype.
        </p>
        <Link
          href="/"
          className="pressable focus-ring mt-6 inline-flex rounded-md bg-accent px-5 py-3 text-sm font-bold text-ink hover:bg-accent-hover"
        >
          Return home
        </Link>
      </div>
    </main>
  );
}
