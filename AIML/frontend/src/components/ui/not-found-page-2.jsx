"use client";

import { motion } from "framer-motion";
import { Compass, Home } from "lucide-react";
import { Button } from '../../components/ui/button.jsx';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '../../components/ui/empty.jsx';

const PRIMARY_ORB_HORIZONTAL_OFFSET = 40;
const PRIMARY_ORB_VERTICAL_OFFSET = 20;

export function NotFoundPage() {
  return (
    <div className="w-full relative flex min-h-screen items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.1),transparent_70%)] text-[var(--foreground)]">
      <div
        aria-hidden={true}
        className="-z-10 absolute inset-0 overflow-hidden"
      >
        <motion.div
          animate={{
            x: [
              0,
              PRIMARY_ORB_HORIZONTAL_OFFSET,
              -PRIMARY_ORB_HORIZONTAL_OFFSET,
              0,
            ],
            y: [
              0,
              PRIMARY_ORB_VERTICAL_OFFSET,
              -PRIMARY_ORB_VERTICAL_OFFSET,
              0,
            ],
            rotate: [0, 10, -10, 0],
          }}
          className="absolute top-1/2 left-1/3 h-64 w-64 rounded-full bg-gradient-to-tr from-purple-500/20 to-blue-500/20 blur-3xl"
          transition={{
            repeat: Number.POSITIVE_INFINITY,
            duration: 5,
            ease: "easeInOut",
          }}
        />
        <motion.div
          animate={{
            x: [
              0,
              -PRIMARY_ORB_HORIZONTAL_OFFSET,
              PRIMARY_ORB_HORIZONTAL_OFFSET,
              0,
            ],
            y: [
              0,
              -PRIMARY_ORB_VERTICAL_OFFSET,
              PRIMARY_ORB_VERTICAL_OFFSET,
              0,
            ],
          }}
          className="absolute right-1/4 bottom-1/3 h-72 w-72 rounded-full bg-gradient-to-br from-indigo-400/10 to-pink-400/10 blur-3xl"
          transition={{
            repeat: Number.POSITIVE_INFINITY,
            duration: 5,
            ease: "easeInOut",
          }}
        />
      </div>

      <Empty className="border-none bg-transparent">
        <EmptyHeader>
          <EmptyTitle className="font-extrabold text-9xl bg-clip-text text-transparent bg-gradient-to-b from-foreground to-foreground/30">404</EmptyTitle>
          <EmptyDescription className="text-xl">
            The page you&apos;re looking for might have been <br />
            moved or doesn&apos;t exist.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex gap-4">
            <Button asChild size="lg" className="rounded-full px-8">
              <a href="/">
                <Home className="mr-2 h-4 w-4" /> Go Home
              </a>
            </Button>

            <Button asChild variant="outline" size="lg" className="rounded-full px-8">
              <a href="/dashboard">
                <Compass className="mr-2 h-4 w-4" /> Explore
              </a>
            </Button>
          </div>
        </EmptyContent>
      </Empty>
    </div>
  );
}
