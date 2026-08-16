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
