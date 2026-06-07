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
import { useState } from "react";

export function RegisterForm() {
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
      const defaultName = email.split("@")[0].replace(/[._-]+/g, " ");
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: defaultName },
        },
      });

      if (error) {
        toast({
          title: t("auth.registrationFailed"),
          description: error.message,
          variant: "destructive",
        });
        return;
      }

      if (data.user?.identities?.length === 0) {
        toast({
          title: t("auth.accountExists"),
          description: t("auth.accountExistsDescription"),
          variant: "destructive",
        });
        return;
      }

      if (data.session) {
        window.location.href = "/dashboard";
        return;
      }

      // Fallback: if no session returned, sign in explicitly
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        toast({
          title: t("auth.registrationFailed"),
          description: signInError.message,
          variant: "destructive",
        });
        return;
      }

      window.location.href = "/dashboard";
    } finally {
      setLoading(false);
    }
  };

  return (
    <FadeIn delay={0.2} direction="up" duration={0.8}>
      <Card className="transition-all duration-500 hover:shadow-2xl hover:-translate-y-1">
        <CardHeader className="text-center">
          <AuralLogo size={64} className="mx-auto mb-2" />
          <CardTitle className="font-heading text-2xl">
            {t("auth.createAccount")}
          </CardTitle>
          <CardDescription>{t("auth.createAccountSubtitle")}</CardDescription>
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
                placeholder={t("auth.passwordHint")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <Button className="w-full transition-transform duration-300 hover:scale-[1.02] active:scale-[0.98]" type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("auth.createAccount")}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="justify-center">
          <p className="text-sm text-muted-foreground">
            {t("auth.haveAccount")}{" "}
            <Link href="/login" className="text-primary hover:underline">
              {t("auth.signIn")}
            </Link>
          </p>
        </CardFooter>
      </Card>
    </FadeIn>
  );
}
