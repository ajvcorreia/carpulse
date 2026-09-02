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

// Flat, uncascaded suggestion lists for the make/model/spec autocomplete —
// every distinct value seen across all tracked cars, not filtered by any of
// the form's other fields.
export async function getCarFieldOptions(): Promise<{ makes: string[]; models: string[]; specs: string[] }> {
  const supabase = createClient();
  const { data, error } = await supabase.from("cars").select("make, model, spec");
  if (error) throw error;

  const rows = data ?? [];
  return {
    makes: Array.from(new Set(rows.map((c) => c.make))).sort(),
    models: Array.from(new Set(rows.map((c) => c.model))).sort(),
    specs: Array.from(new Set(rows.map((c) => c.spec).filter((v): v is string => !!v))).sort(),
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
