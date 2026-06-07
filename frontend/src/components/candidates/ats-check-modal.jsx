import { useState } from "react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { useToast } from "../../hooks/use-toast";
import { Loader2, Upload, FileText, CheckCircle2, AlertCircle } from "lucide-react";

export function AtsCheckModal({ children }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [jobDescription, setJobDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const { toast } = useToast();

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
      if (selected.type !== "application/pdf" && !selected.name.endsWith(".pdf")) {
        toast({ title: "Invalid file", description: "Please upload a PDF file.", variant: "destructive" });
        return;
      }
      setFile(selected);
      setResult(null); // reset previous results
    }
  };

  const handleAnalyze = async () => {
    if (!file) return;
    setLoading(true);
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("jobDescription", jobDescription);

    try {
      const response = await fetch("/api/ats", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to analyze resume.");
      }

      const data = await response.json();
      setResult(data);
    } catch (error) {
      toast({
        title: "Analysis Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>ATS Resume Checker</DialogTitle>
          <DialogDescription>
            Upload a candidate's resume (PDF) and optionally provide a Job Description to get an AI-powered ATS match score.
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="grid gap-6 py-4">
            <div className="grid gap-2">
              <Label htmlFor="resume">Resume (PDF)</Label>
              <div className="flex items-center gap-4">
                <Input id="resume" type="file" accept=".pdf" onChange={handleFileChange} className="cursor-pointer" />
                {file && <FileText className="h-5 w-5 text-primary" />}
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="jd">Job Description (Optional)</Label>
              <Textarea
                id="jd"
                placeholder="Paste the job description here to analyze keyword matches..."
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                className="min-h-[120px]"
              />
            </div>

            <Button onClick={handleAnalyze} disabled={!file || loading} className="w-full">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Analyzing Resume...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Run ATS Check
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="grid gap-6 py-4 animate-in fade-in zoom-in duration-300">
            <div className="flex flex-col items-center justify-center p-6 bg-muted/30 rounded-lg border">
              <div className="text-sm font-medium text-muted-foreground mb-1">Overall ATS Score</div>
              <div className={`text-5xl font-bold ${result.score >= 70 ? "text-green-500" : result.score >= 40 ? "text-amber-500" : "text-destructive"}`}>
                {result.score}%
              </div>
            </div>

            {result.keywordsMatched?.length > 0 && (
              <div>
                <h4 className="flex items-center gap-2 font-semibold mb-2 text-green-600">
                  <CheckCircle2 className="h-4 w-4" /> Keywords Matched
                </h4>
                <div className="flex flex-wrap gap-2">
                  {result.keywordsMatched.map((kw, i) => (
                    <span key={i} className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-md">{kw}</span>
                  ))}
                </div>
              </div>
            )}

            {result.keywordsMissing?.length > 0 && (
              <div>
                <h4 className="flex items-center gap-2 font-semibold mb-2 text-destructive">
                  <AlertCircle className="h-4 w-4" /> Keywords Missing
                </h4>
                <div className="flex flex-wrap gap-2">
                  {result.keywordsMissing.map((kw, i) => (
                    <span key={i} className="bg-red-100 text-red-800 text-xs px-2 py-1 rounded-md">{kw}</span>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h4 className="font-semibold mb-2">Feedback & Suggestions</h4>
              <p className="text-sm text-muted-foreground bg-muted p-4 rounded-md leading-relaxed">
                {result.feedback}
              </p>
            </div>

            <Button variant="outline" onClick={() => setResult(null)} className="w-full">
              Check Another Resume
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
