import React from "react";
import LandingNav from "@/components/landing/LandingNav";
import LandingHero from "@/components/landing/LandingHero";
import LandingFeatures from "@/components/landing/LandingFeatures";
import LandingVideo from "@/components/landing/LandingVideo";
import LandingShowcase from "@/components/landing/LandingShowcase";
import LandingTestimonials from "@/components/landing/LandingTestimonials";
import LandingPlans from "@/components/landing/LandingPlans";
import LandingDownload from "@/components/landing/LandingDownload";
import LandingCTA from "@/components/landing/LandingCTA";
import LandingFooter from "@/components/landing/LandingFooter";

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <LandingNav />
      <main>
        <LandingHero />
        <LandingFeatures />
        <LandingVideo />
        <LandingShowcase />
        <LandingTestimonials />
        <LandingPlans />
        <LandingDownload />
        <LandingCTA />
      </main>
      <LandingFooter />
    </div>
  );
}
