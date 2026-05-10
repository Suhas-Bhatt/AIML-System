"use client";

import { CinematicFooter } from '../../components/ui/motion-footer.jsx';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '../../components/ui/interfaces-hover-card.jsx';
import ThreeDMarquee from '../../components/ui/3d-marquee.jsx';
import { Info, Code2 } from "lucide-react";

export default function MotionDemoPage() {
  return (
    <div className="relative w-full bg-background min-h-screen font-sans selection:bg-primary/20 overflow-x-hidden">
      {/* 
        MAIN CONTENT AREA 
        High z-index and minimum height to allow scroll reveal 
      */}
      <main className="relative z-10 w-full min-h-[150vh] bg-background flex flex-col items-center justify-center text-foreground border-b border-border shadow-sm rounded-b-[3rem] pb-24">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_center,rgba(var(--primary),0.03)_0%,transparent_60%)] pointer-events-none" />
        
        <div className="max-w-3xl w-full px-6 space-y-12 text-center">
          <div className="space-y-4">
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight">
              Premium UI Components
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto font-medium">
              Experience the synergy of GSAP-powered motion and Radix-backed accessibility.
            </p>
          </div>

          <div className="flex flex-col items-center gap-8">
            <div className="flex items-center gap-4">
               <HoverCard openDelay={0} closeDelay={75}>
                <HoverCardTrigger asChild>
                  <button className="flex items-center gap-2 px-6 py-3 rounded-full bg-primary text-primary-foreground font-semibold transition-transform hover:scale-105 active:scale-95 shadow-lg shadow-primary/20">
                    <Info className="h-4 w-4" />
                    Hover for AI Stats
                  </button>
                </HoverCardTrigger>
                <HoverCardContent side="bottom" align="center" className="w-80 p-6 bg-card/80 backdrop-blur-xl border-primary/20">
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
                        <Code2 className="h-6 w-6 text-primary" />
                      </div>
                      <div>
                        <h4 className="font-bold text-lg">Interview AI</h4>
                        <p className="text-sm text-muted-foreground">v2.4.0-pro</p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm leading-relaxed">
                        Our advanced LLM engine provides real-time feedback with <span className="text-primary font-bold">98.2%</span> accuracy in technical evaluation.
                      </p>
                      <div className="pt-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary">
                        <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                        System Online
                      </div>
                    </div>
                  </div>
                </HoverCardContent>
              </HoverCard>
            </div>

            <div className="w-[1px] h-32 bg-gradient-to-b from-primary to-transparent" />
            
            <p className="text-sm font-bold tracking-[0.3em] uppercase text-muted-foreground animate-bounce">
              Scroll down to reveal footer
            </p>
          </div>

          {/* 3D Marquee Section */}
          <div className="w-full max-w-6xl mx-auto py-24">
            <h3 className="text-2xl font-bold mb-8 text-center text-muted-foreground uppercase tracking-widest">
              Built with Modern Stack
            </h3>
            <ThreeDMarquee className="border border-border/50 bg-muted/20 shadow-2xl" />
          </div>
        </div>
      </main>

      {/* The Cinematic Footer is revealed here */}
      <CinematicFooter />
    </div>
  );
}
