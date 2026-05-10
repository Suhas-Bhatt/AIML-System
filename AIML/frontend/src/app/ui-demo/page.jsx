"use client";

import React from 'react';
import { Alert, AlertIcon, AlertTitle, AlertContent, AlertDescription } from '../../components/ui/alert-1.jsx';
import { Button } from '../../components/ui/button-1.jsx';
import { GlowCard } from '../../components/ui/spotlight-card.jsx';
import { SunnyGlowBackground } from '../../components/ui/background-components.jsx';
import { BouncingDots } from '../../components/ui/bouncing-dots.jsx';
import { AnimatedStateIconsDemo } from '../../components/ui/animated-state-icons.jsx';
import { IconGrid } from '../../components/ui/icon-set.jsx';
import { Workspaces, WorkspaceTrigger, WorkspaceContent } from '../../components/ui/workspaces.jsx';
import { AvatarGroup } from '../../components/ui/avatar-group.jsx';
import { 
  Bell, 
  CircleAlert, 
  CircleCheck, 
  MessageSquareWarning, 
  ShieldAlert, 
  TriangleAlert,
  ArrowRight,
  Download,
  Github,
  Zap,
  Cpu,
  Apple,
  Twitter,
  Figma,
  Slack,
  Gitlab,
  Youtube,
  Linkedin,
  Dribbble,
  Twitch,
  Facebook,
  Instagram,
  PlusIcon,
  Search
} from 'lucide-react';
import Link from 'next/link';

export default function UIDemoPage() {
  const [activeWorkspaceId, setActiveWorkspaceId] = React.useState('1');

  return (
    <SunnyGlowBackground className="p-10">
      <div className="space-y-12 max-w-4xl mx-auto">
        <section className="space-y-4">
          <div className="flex justify-between items-end">
            <div>
              <h1 className="text-4xl font-bold tracking-tight">Advanced UI Primitives</h1>
              <p className="text-muted-foreground">High-fidelity layout and navigation components.</p>
            </div>
            <Link href="/404-preview">
              <Button variant="outline" size="sm" className="rounded-full">
                Preview 404 Page
                <Search className="ml-2 h-3 w-3" />
              </Button>
            </Link>
          </div>
          
          <div className="bg-card/50 border border-border p-8 rounded-2xl flex flex-col items-center gap-6">
            <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Workspace Switcher</h3>
            <Workspaces
              workspaces={workspaces}
              selectedWorkspaceId={activeWorkspaceId}
              onWorkspaceChange={(ws) => setActiveWorkspaceId(ws.id)}
            >
              <WorkspaceTrigger className="w-full max-w-xs shadow-lg" />
              <WorkspaceContent searchable title="Your Companies">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground w-full justify-start hover:bg-primary/10 hover:text-primary transition-colors"
                >
                  <PlusIcon className="mr-2 h-4 w-4" />
                  Create workspace
                </Button>
              </WorkspaceContent>
            </Workspaces>

            <div className="flex flex-col items-center gap-2">
               <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Active Interviewers</h3>
               <AvatarGroup
                  avatars={demoAvatars}
                  maxVisible={4}
                  size={48}
                  overlap={16}
               />
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h1 className="text-4xl font-bold tracking-tight">Advanced Glow Components</h1>
          <p className="text-muted-foreground">High-fidelity cursor tracking and ambient lighting.</p>
          
          <div className="flex flex-wrap gap-8 justify-center py-8">
            <GlowCard glowColor="blue" size="md" className="flex flex-col items-center justify-center text-center gap-4">
              <Zap className="h-12 w-12 text-blue-400" />
              <h3 className="text-xl font-bold">Quantum Core</h3>
              <p className="text-sm text-muted-foreground px-4">Ultra-fast processing for real-time interview analysis.</p>
            </GlowCard>

            <GlowCard glowColor="purple" size="md" className="flex flex-col items-center justify-center text-center gap-4">
              <ShieldAlert className="h-12 w-12 text-purple-400" />
              <h3 className="text-xl font-bold">SafeGuard AI</h3>
              <p className="text-sm text-muted-foreground px-4">Military-grade proctoring and anti-cheating detection.</p>
            </GlowCard>

            <GlowCard glowColor="green" size="md" className="flex flex-col items-center justify-center text-center gap-4">
              <Cpu className="h-12 w-12 text-emerald-400" />
              <h3 className="text-xl font-bold">Neural Engine</h3>
              <div className="pt-2">
                <BouncingDots dots={3} message="Syncing..." messagePlacement="right" className="bg-emerald-400" />
              </div>
            </GlowCard>
          </div>
        </section>

        <section className="space-y-4">
          <h1 className="text-4xl font-bold tracking-tight">Advanced Alert Components</h1>
        <p className="text-muted-foreground">Premium alerts with multiple variants and appearance modes.</p>
        
        <div className="grid gap-4">
          <Alert appearance="light" close={true} variant="primary">
            <AlertIcon>
              <CircleAlert />
            </AlertIcon>
            <AlertContent>
              <AlertTitle>System Update Available</AlertTitle>
              <AlertDescription>A new version of the AI engine is ready for deployment.</AlertDescription>
            </AlertContent>
          </Alert>

          <Alert variant="success" appearance="light" close={true}>
            <AlertIcon>
              <CircleCheck />
            </AlertIcon>
            <AlertTitle>Analysis Complete</AlertTitle>
          </Alert>

          <Alert variant="destructive" appearance="solid" close={true}>
            <AlertIcon>
              <TriangleAlert />
            </AlertIcon>
            <AlertTitle>Critical Security Breach Detected</AlertTitle>
          </Alert>

          <Alert variant="warning" appearance="outline" close={true}>
            <AlertIcon>
              <ShieldAlert />
            </AlertIcon>
            <AlertTitle>Low API Credits Warning</AlertTitle>
          </Alert>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-3xl font-bold tracking-tight">Advanced Button Components</h2>
        <p className="text-muted-foreground">High-fidelity buttons with complex state management and styling.</p>
        
        <div className="flex flex-wrap gap-4">
          <Button variant="primary" size="lg">
            Get Started
            <ArrowRight className="ml-2" />
          </Button>
          
          <Button variant="outline" size="lg">
            <Github className="mr-2" />
            View Source
          </Button>

          <Button variant="secondary" size="md">
            <Download className="mr-2" />
            Download PDF
          </Button>

          <Button variant="mono" size="md" shape="circle" mode="icon">
            <Bell />
          </Button>

          <Button variant="ghost" size="sm">
            Cancel
          </Button>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-3xl font-bold tracking-tight">Button Modes</h2>
        <div className="flex flex-wrap gap-4 items-center">
          <Button mode="link" variant="primary" underline="solid">
            Primary Link
          </Button>
          <Button mode="input" variant="outline" className="w-64">
            <MessageSquareWarning className="mr-2 text-muted-foreground" />
            Search conversations...
          </Button>
        </div>
      </section>

      <section className="space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">Micro-Interactions</h1>
        <AnimatedStateIconsDemo />
      </section>

      <section className="space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">Social Integrations</h1>
        <IconGrid items={socialIcons} />
      </section>
      </div>
    </SunnyGlowBackground>
  );
}

const IconWrapper = ({ children }) => (
  <div className="h-12 w-12 text-foreground/80 transition-transform duration-300 group-hover:scale-110 group-hover:text-foreground">
    {children}
  </div>
);

const socialIcons = [
  { id: "apple", icon: <IconWrapper><Apple className="h-full w-full" /></IconWrapper>, name: "Apple" },
  { id: "twitter", icon: <IconWrapper><Twitter className="h-full w-full" /></IconWrapper>, name: "Twitter" },
  { id: "github", icon: <IconWrapper><Github className="h-full w-full" /></IconWrapper>, name: "GitHub" },
  { id: "figma", icon: <IconWrapper><Figma className="h-full w-full" /></IconWrapper>, name: "Figma" },
  { id: "slack", icon: <IconWrapper><Slack className="h-full w-full" /></IconWrapper>, name: "Slack" },
  { id: "gitlab", icon: <IconWrapper><Gitlab className="h-full w-full" /></IconWrapper>, name: "GitLab" },
  { id: "youtube", icon: <IconWrapper><Youtube className="h-full w-full" /></IconWrapper>, name: "YouTube" },
  { id: "linkedin", icon: <IconWrapper><Linkedin className="h-full w-full" /></IconWrapper>, name: "LinkedIn" },
  { id: "dribbble", icon: <IconWrapper><Dribbble className="h-full w-full" /></IconWrapper>, name: "Dribbble" },
  { id: "twitch", icon: <IconWrapper><Twitch className="h-full w-full" /></IconWrapper>, name: "Twitch" },
  { id: "facebook", icon: <IconWrapper><Facebook className="h-full w-full" /></IconWrapper>, name: "Facebook" },
  { id: "instagram", icon: <IconWrapper><Instagram className="h-full w-full" /></IconWrapper>, name: "Instagram" },
];

const workspaces = [
  {
    id: '1',
    name: 'Asme Inc.',
    logo: 'https://avatar.vercel.sh/asme',
    plan: 'Free',
    slug: 'asme',
  },
  {
    id: '2',
    name: 'Bilux Labs',
    logo: 'https://avatar.vercel.sh/bilux',
    plan: 'Pro',
    slug: 'bilux',
  },
  {
    id: '3',
    name: 'Zentra Ltd.',
    logo: 'https://avatar.vercel.sh/zentra',
    plan: 'Team',
    slug: 'zentra',
  },
];

const demoAvatars = [
  {
    src: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=100&h=100",
    label: "Alex Chen",
  },
  {
    src: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=100&h=100",
    label: "Sarah Smith",
  },
  {
    src: "https://images.unsplash.com/photo-1599566150163-29194dcaad36?auto=format&fit=crop&q=80&w=100&h=100",
    label: "James Wilson",
  },
  {
    src: "https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&q=80&w=100&h=100",
    label: "Emily Davis",
  },
  {
    src: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&q=80&w=100&h=100",
    label: "Jessica Lee",
  },
];
