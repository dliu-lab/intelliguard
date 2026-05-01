import { Architecture } from "@/components/Architecture";
import { AuthModal } from "@/components/AuthModal";
import { BrandSplash } from "@/components/BrandSplash";
import { CTA } from "@/components/CTA";
import { Capabilities } from "@/components/Capabilities";
import { DeveloperSection } from "@/components/DeveloperSection";
import { FacilitatorBot } from "@/components/FacilitatorBot";
import { Footer } from "@/components/Footer";
import { Hero } from "@/components/Hero";
import { Navbar } from "@/components/Navbar";
import { UseCases } from "@/components/UseCases";

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-x-hidden bg-ink text-textPrimary">
      <div className="app-backdrop pointer-events-none fixed inset-0 -z-20" />
      <div className="grid-overlay pointer-events-none fixed inset-0 -z-10 opacity-60" />
      <BrandSplash />
      <Navbar />
      <Hero />
      <Capabilities />
      <Architecture />
      <UseCases />
      <DeveloperSection />
      <CTA />
      <Footer />
      <FacilitatorBot />
      <AuthModal />
    </main>
  );
}
