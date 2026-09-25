import { PocketIdSecretsBanner } from "@/app/_components/pocketid-secrets-banner";

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <>
      <PocketIdSecretsBanner />
      {children}
    </>
  );
}
