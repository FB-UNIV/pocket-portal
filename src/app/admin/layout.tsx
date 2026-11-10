import { PocketIdSecretsBanner } from "@/app/_components/pocketid-secrets-banner";
import { AdminNav } from "./_components/admin-nav";

// Every /admin page: the secrets warning across the top, then the admin
// tabs above the page, which gets the full width.
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <>
      <PocketIdSecretsBanner />
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-7 px-6 pt-7 pb-20">
        <AdminNav />
        <div className="min-w-0">{children}</div>
      </div>
    </>
  );
}
