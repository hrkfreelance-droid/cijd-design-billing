"use client";

import { useI18n } from "@/components/providers";

const copy = {
  choose: ["履歴・型から選ぶ", "Choose from history or formats", "ជ្រើសពីប្រវត្តិ ឬទម្រង់"],
  search: ["品名・説明を検索", "Search services and descriptions", "ស្វែងរកសេវា និងការពិពណ៌នា"],
  customer: ["このお客さんの過去の物", "This customer's past services", "សេវាពីមុនរបស់អតិថិជននេះ"],
  formats: ["型", "Formats", "ទម្រង់"],
  history: ["すべての履歴", "All history", "ប្រវត្តិទាំងអស់"],
  previous: ["前回", "Previous", "លើកមុន"],
  estimate: ["目安", "Reference", "តម្លៃយោង"],
  similar: ["似た物 {count}件", "{count} similar items", "មុខទំនិញស្រដៀងគ្នា {count}"],
  sparse: ["参考（少ない）", "Reference (few samples)", "តម្លៃយោង (ទិន្នន័យតិច)"],
  basis: ["目安の根拠", "Price basis", "មូលដ្ឋានតម្លៃ"],
  method: ["同じサービス・単位で、説明・サイズが似ていて数量が近い明細の単価の中央値（幅は最小〜最大）。", "Median unit price of similar descriptions and sizes in the same service and unit, prioritizing nearby quantities. Range: minimum–maximum.", "តម្លៃឯកតាមេដ្យាននៃការពិពណ៌នា និងទំហំស្រដៀងគ្នាក្នុងសេវា និងឯកតាដូចគ្នា ដោយផ្តល់អាទិភាពដល់បរិមាណជិតគ្នា។ ជួរតម្លៃ៖ អប្បបរមា–អតិបរមា។"],
  pending: ["Price pending", "Price pending", "Price pending"],
  applyEstimate: ["目安の単価を使う", "Use reference unit price", "ប្រើតម្លៃយោងក្នុងមួយឯកតា"],
  uses: ["回", "orders", "ការបញ្ជាទិញ"],
  unknown: ["単価なし", "No price yet", "មិនទាន់មានតម្លៃ"],
  addAlso: ["+ {name} も足す", "+ Add {name}", "+ បន្ថែម {name} ផងដែរ"],
  empty: ["候補がありません。説明を直接入力できます。", "No matches. You can enter a description below.", "គ្មានលទ្ធផល។ អាចបញ្ចូលការពិពណ៌នាខាងក្រោម។"],
  close: ["候補を閉じる", "Close suggestions", "បិទការណែនាំ"],
  more: ["続きを表示", "Show more", "បង្ហាញបន្ថែម"],
  manage: ["型の一覧・編集", "Manage service formats", "គ្រប់គ្រងទម្រង់សេវា"],
  settings: ["設定", "Settings", "ការកំណត់"],
  help: ["履歴から説明・数量・単価の目安をまとめています。編集した型は次回からも使えます。", "Descriptions, quantities and reference prices come from history. Your edits are saved for future services.", "ការពិពណ៌នា បរិមាណ និងតម្លៃយោងមកពីប្រវត្តិ។ ការកែប្រែត្រូវបានរក្សាទុកសម្រាប់សេវាពេលក្រោយ។"],
  name: ["名前", "Name", "ឈ្មោះ"],
  description: ["説明", "Description", "ការពិពណ៌នា"],
  unit: ["単位", "Unit", "ឯកតា"],
  quantity: ["数量", "Quantity", "បរិមាណ"],
  price: ["目安の単価", "Reference unit price", "តម្លៃយោងក្នុងមួយឯកតា"],
  service: ["サービスの種類", "Service type", "ប្រភេទសេវា"],
  active: ["候補に出す", "Show in suggestions", "បង្ហាញក្នុងការណែនាំ"],
  inactive: ["非表示", "Hidden", "លាក់"],
  new: ["型を追加", "Add format", "បន្ថែមទម្រង់"],
  saved: ["型を保存しました", "Format saved", "បានរក្សាទុកទម្រង់"],
  edit: ["編集", "Edit", "កែប្រែ"],
  manual: ["変更済み", "Edited", "បានកែប្រែ"],
} as const;

export function useSuggestionT() {
  const { locale } = useI18n();
  const index = locale === "ja" ? 0 : locale === "en" ? 1 : 2;
  return (key: keyof typeof copy) => copy[key][index];
}
