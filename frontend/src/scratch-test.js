import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  const { data, error } = await supabase
    .from("sessions")
    .select("*, interview:interviews!inner(*, questions(*)), messages(*)")
    .order("order", {
      referencedTable: "interviews.questions",
      ascending: true,
    })
    .order("timestamp", { referencedTable: "messages", ascending: true })
    .limit(1);

  console.log("Data:", data);
  console.log("Error:", error);
}

run();
