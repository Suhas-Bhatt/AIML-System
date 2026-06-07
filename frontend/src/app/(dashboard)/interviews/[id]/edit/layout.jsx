"use client";

import { ShareModal } from '../../../../../components/interview/share-modal.jsx';
import { Badge } from '../../../../../components/ui/badge.jsx';
import { Button } from '../../../../../components/ui/button.jsx';
import { Skeleton } from '../../../../../components/ui/skeleton.jsx';
import { useToast } from '../../../../../hooks/use-toast.js';
import { trpc } from '../../../../../lib/trpc/client.js';
import { cn } from '../../../../../lib/utils.js';
import { Eye, Link2, ListOrdered, Lock, Loader2, Settings, Share2, Users } from "lucide-react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { EditInterviewProvider } from './edit-context.js';

const tabSkeletons = {
  content: (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-40" />
      <Skeleton className="h-40" />
    </div>
  ),
  settings: (
    <div className="grid gap-6 md:grid-cols-2">
      <Skeleton className="h-40 md:col-span-2" />
      <Skeleton className="h-[400px]" />
      <Skeleton className="h-[400px]" />
    </div>
  ),
  sessions: (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-[400px]" />
    </div>
  ),
};

const tabs = [
  { value: "content", label: "Content", icon: ListOrdered, href: "" },
  { value: "settings", label: "Settings", icon: Settings, href: "/settings" },
  { value: "sessions", label: "Sessions", icon: Users, href: "/sessions" },
];

export default function EditInterviewLayout({
  children,
}) {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [pendingTab, setPendingTab] = useState(null);
  const id = params.id;
  const basePath = `/interviews/${id}/edit`;

  const interview = trpc.interview.getById.useQuery({ id });
  const utils = trpc.useUtils();
  const [shareOpen, setShareOpen] = useState(false);
  const createPreviewMutation = trpc.session.createPreview.useMutation();

  const updateMutation = trpc.interview.update.useMutation({
    onSuccess: () => {
      utils.interview.getById.invalidate({ id });
      toast({ title: "Interview updated" });
    },
  });

  const activeTab = useMemo(() => {
    if (pathname.endsWith("/settings")) return "settings";
    if (pathname.endsWith("/sessions")) return "sessions";
    return "content";
  }, [pathname]);

  const publishMutation = trpc.interview.publish.useMutation();

  const handlePreview = async () => {
    if (!interview.data) return;
    let slug = interview.data.publicSlug;
    if (!slug) {
      try {
        const result = await publishMutation.mutateAsync({ id });
        slug = result.slug;
        utils.interview.getById.invalidate({ id });
      } catch {
        toast({ title: "Failed to generate preview link", variant: "destructive" });
        return;
      }
    }
    try {
      const { sessionId } = await createPreviewMutation.mutateAsync({
        interviewId: id,
      });
      window.open(`/i/${slug}?sid=${sessionId}&preview=true`, "_blank");
    } catch {
      toast({ title: "Failed to start preview", variant: "destructive" });
    }
  };

  if (interview.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-[600px]" />
      </div>
    );
  }

  if (!interview.data) {
    return <div>Interview not found</div>;
  }

  const data = interview.data;
  const publicSlug =
    typeof data.publicSlug === "string"
      ? data.publicSlug
      : null;
  const shareIsPublic = !!(
    publicSlug &&
    data.isActive &&
    !data.requireInvite
  );

  return (
    <EditInterviewProvider
      value={{ interview: data, interviewId: id, updateMutation }}
    >
      <div className="space-y-6">
        {/* Header */}
        <div className="no-print flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
          <h1 className="text-2xl font-bold">{data.title}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            {data.publicSlug && data.isActive && !data.requireInvite ? (
              <Badge
                variant="outline"
                className="cursor-pointer gap-1 border-border bg-background text-foreground hover:bg-muted"
                onClick={() => {
                  navigator.clipboard.writeText(
                    `${window.location.origin}/i/${data.publicSlug}`,
                  );
                  toast({ title: "Link copied!" });
                }}
              >
                <Link2 className="h-3 w-3" />
                /i/{data.publicSlug}
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1">
                <Lock className="h-3 w-3" />
                Invite only
              </Badge>
            )}
            {data.chatEnabled && <Badge variant="outline">Chat</Badge>}
            {data.voiceEnabled && <Badge variant="outline">Voice</Badge>}
            {data.videoEnabled && <Badge variant="outline">Video</Badge>}
          </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setShareOpen(true)}
            >
              <Share2 className="h-4 w-4" />
              Share
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={createPreviewMutation.isPending || publishMutation.isPending}
              onClick={() => void handlePreview()}
            >
              {(createPreviewMutation.isPending || publishMutation.isPending) ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
              Preview
            </Button>
          </div>
        </div>

        <ShareModal
          open={shareOpen}
          onOpenChange={setShareOpen}
          interviewId={id}
          publicSlug={publicSlug}
          isPublic={shareIsPublic}
        />

        {/* Tab navigation */}
        <div
          className="inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground no-print"
          role="tablist"
        >
          {tabs.map((tab) => {
            const displayTab = isPending && pendingTab ? pendingTab : activeTab;
            const isActive = displayTab === tab.value;
            return (
              <button
                key={tab.value}
                role="tab"
                aria-selected={isActive}
                disabled={isActive}
                onClick={() => {
                  setPendingTab(tab.value);
                  startTransition(() => {
                    router.push(`${basePath}${tab.href}`);
                  });
                }}
                className={cn(
                  "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 gap-2",
                  isActive
                    ? "bg-background text-foreground shadow-sm"
                    : "hover:text-foreground/80",
                )}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        {isPending && pendingTab ? tabSkeletons[pendingTab] : children}
      </div>
    </EditInterviewProvider>
  );
}
