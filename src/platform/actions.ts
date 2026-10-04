import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AppError } from "@/platform/errors";

/**
 * Run a mutation from a server action, then redirect back to `path`.
 * User-facing errors (AppError) are shown via ?error=...; anything else is rethrown.
 */
export async function runAndRedirect(path: string, fn: () => Promise<unknown>): Promise<never> {
  let error: string | undefined;
  try {
    await fn();
  } catch (e) {
    if (e instanceof AppError) error = e.message;
    else throw e;
  }
  revalidatePath(path);
  redirect(error ? `${path}?error=${encodeURIComponent(error)}` : path);
}
