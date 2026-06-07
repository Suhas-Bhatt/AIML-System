import AnoAI from '../../components/ui/animated-shader-background.jsx';

export default function AuthLayout({
  children,
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-12">
      <AnoAI />
      <div className="relative z-10 w-full max-w-md">{children}</div>
    </div>
  );
}
