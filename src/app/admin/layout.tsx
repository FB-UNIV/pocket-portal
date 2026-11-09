import { PocketIdSecretsBanner } from "@/app/_components/pocketid-secrets-banner";
import { AdminNav } from "./_components/admin-nav";

// Every /admin page: the secrets warning across the top, then the admin
// side menu beside the page (above it on narrow screens).
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <>
      <PocketIdSecretsBanner />
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 pt-6 pb-20 lg:flex-row lg:gap-10 lg:pt-8">
        <AdminNav />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </>
  );
}
