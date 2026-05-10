"use client";

import { useAppLocale } from '../../components/app-locale-provider.jsx';
import { AuralLogo } from '../../components/ui/aural-logo.jsx';
import { Button } from '../../components/ui/button.jsx';
import { FadeIn } from '../../components/ui/fade-in.jsx';
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from '../../components/ui/card.jsx';
import { Input } from '../../components/ui/input.jsx';
import { Label } from '../../components/ui/label.jsx';
import { useToast } from '../../hooks/use-toast.js';
import { createClient } from '../../lib/supabase/client.js';
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useAppLocale();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const supabase = createClient();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        toast({
          title: t("auth.errorTitle"),
          description: t("auth.invalidEmailOrPassword"),
          variant: "destructive",
        });
        setLoading(false);
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    } catch {
      setLoading(false);
    }
  };

  return (
    <FadeIn delay={0.2} direction="up" duration={0.8}>
      <Card className="transition-all duration-500 hover:shadow-2xl hover:-translate-y-1">
        <CardHeader className="text-center">
          <AuralLogo size={64} className="mx-auto mb-2" />
          <CardTitle className="font-heading text-2xl">
            {t("auth.welcomeBack")}
          </CardTitle>
          <CardDescription>{t("auth.signInSubtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t("auth.email")}</Label>
              <Input
                id="email"
                type="email"
                placeholder={t("auth.emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t("auth.password")}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button className="w-full transition-transform duration-300 hover:scale-[1.02] active:scale-[0.98]" type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("auth.signIn")}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="justify-center">
          <p className="text-sm text-muted-foreground">
            {t("auth.noAccount")}{" "}
            <Link href="/register" className="text-primary hover:underline">
              {t("auth.signUp")}
            </Link>
          </p>
        </CardFooter>
      </Card>
    </FadeIn>
  );
}
