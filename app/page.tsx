import { UploadForm } from "./components/upload-form";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 via-slate-50 to-white px-6 py-12 font-sans text-slate-900 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 dark:text-slate-100">
      <main className="mx-auto flex max-w-6xl flex-col items-center gap-10">
        <header className="text-center sm:text-left">
          <p className="text-sm font-semibold uppercase tracking-wider text-indigo-500 dark:text-indigo-300">
            Blood on the Clocktower Toolkit
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-4xl">
            Mirror script assets to your S3 bucket
          </h1>
          <p className="mt-3 max-w-2xl text-base text-slate-600 dark:text-slate-300">
            Upload a custom Blood on the Clocktower script JSON. We will validate it against the official schema, locate every referenced image, download and store it in your configured S3-compatible bucket using friendly naming, then provide a rewritten script pointing to the mirrored assets.
          </p>
        </header>

        <UploadForm />
      </main>
    </div>
  );
}
