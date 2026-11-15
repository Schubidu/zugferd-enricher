import { CATEGORY_IDS, classifyDescription } from "./classify";
import type { Category, Classification } from "./classify";
import type { LineItem } from "./model";
import { parseCents } from "./money";

export type CategorySummary = {
  category: Category;
  count: number;
  invalidCount: number;
  totalCents: bigint | null;
};

/**
 * Categorize only recognized line items. These are their printed amounts:
 * never assume net/gross basis or use a category to infer tax treatment.
 */
export function summarizeCategories(
  items: readonly LineItem[],
  classifications: Readonly<Record<string, Classification>>,
): CategorySummary[] {
  const groups = new Map<Category, { count: number; invalidCount: number; cents: bigint }>();

  for (const item of items) {
    const category = classifications[item.id]?.category ?? classifyDescription(item.description).category;
    const group = groups.get(category) ?? { count: 0, invalidCount: 0, cents: 0n };
    group.count++;
    const amount = parseCents(item.amount);
    if (amount === null) group.invalidCount++;
    else group.cents += amount;
    groups.set(category, group);
  }

  return CATEGORY_IDS.flatMap(category => {
    const group = groups.get(category);
    return group ? [{
      category,
      count: group.count,
      invalidCount: group.invalidCount,
      totalCents: group.invalidCount === 0 ? group.cents : null,
    }] : [];
  });
}
