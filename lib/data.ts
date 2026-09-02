import { createClient } from "@/lib/supabase/server";
import type { CarWithPrices } from "@/lib/types";

export async function getCarsWithPrices(): Promise<CarWithPrices[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("cars")
    .select("*, price_history(*)")
    .order("created_at", { ascending: false })
    .order("recorded_at", { foreignTable: "price_history", ascending: true })
    // Same-day entries tie on recorded_at alone — break ties by insertion order.
    .order("created_at", { foreignTable: "price_history", ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as CarWithPrices[];
}

export async function getCarWithPrices(id: string): Promise<CarWithPrices | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("cars")
    .select("*, price_history(*)")
    .eq("id", id)
    .order("recorded_at", { foreignTable: "price_history", ascending: true })
    // Same-day entries tie on recorded_at alone — break ties by insertion order.
    .order("created_at", { foreignTable: "price_history", ascending: true })
    .maybeSingle();

  if (error) throw error;
  return data as unknown as CarWithPrices | null;
}

// Suggestion lists for the make/model/spec autocomplete. Models are grouped
// by make (lowercased, for case-insensitive lookup as the user types) so the
// form can narrow model suggestions to the chosen make; makes/specs stay
// flat since nothing upstream of them to filter by.
export async function getCarFieldOptions(): Promise<{
  makes: string[];
  specs: string[];
  modelsByMake: Record<string, string[]>;
}> {
  const supabase = createClient();
  const { data, error } = await supabase.from("cars").select("make, model, spec");
  if (error) throw error;

  const rows = data ?? [];
  const makes = Array.from(new Set(rows.map((c) => c.make))).sort();
  const specs = Array.from(new Set(rows.map((c) => c.spec).filter((v): v is string => !!v))).sort();

  const modelsByMake: Record<string, Set<string>> = {};
  for (const c of rows) {
    const key = c.make.toLowerCase();
    (modelsByMake[key] ??= new Set()).add(c.model);
  }

  return {
    makes,
    specs,
    modelsByMake: Object.fromEntries(
      Object.entries(modelsByMake).map(([key, set]) => [key, Array.from(set).sort()])
    ),
  };
}

export async function getCarByUrl(url: string): Promise<CarWithPrices | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("cars")
    .select("*, price_history(*)")
    .eq("url", url)
    .order("recorded_at", { foreignTable: "price_history", ascending: true })
    // Same-day entries tie on recorded_at alone — break ties by insertion order.
    .order("created_at", { foreignTable: "price_history", ascending: true })
    .maybeSingle();

  if (error) throw error;
  return data as unknown as CarWithPrices | null;
}
