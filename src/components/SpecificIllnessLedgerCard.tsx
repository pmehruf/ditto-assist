import React from "react";
import { Search } from "lucide-react";

interface SpecificIllnessLedgerCardProps {
  theme: string;
  selectedPlan: string;
  illnessSearchQuery: string;
  setIllnessSearchQuery: (query: string) => void;
  specificIllnessesDict: Record<string, Array<{ category?: string; illness: string }>>;
}

export const SpecificIllnessLedgerCard: React.FC<SpecificIllnessLedgerCardProps> = ({
  theme,
  selectedPlan,
  illnessSearchQuery,
  setIllnessSearchQuery,
  specificIllnessesDict,
}) => {
  return (
    <div className="flex flex-col flex-grow h-full min-h-0 select-none space-y-4 font-sans">
      {/* Search Bar & Conditions Count Badge (merged directly under the main card header) */}
      {selectedPlan ? (
        <div className="flex items-center gap-2 font-sans select-none w-full shrink-0">
          <div className="relative flex-grow">
            <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-stone-500 pointer-events-none" />
            <input
              type="text"
              value={illnessSearchQuery}
              onChange={(e) => setIllnessSearchQuery(e.target.value)}
              placeholder="Search illnesses..."
              className={`w-full text-[10px] pl-8 pr-3 py-1.5 rounded-xl border font-sans font-medium focus:outline-none transition-all duration-200 ${
                theme === "dark"
                  ? "bg-black/40 border-white/[0.08] text-white placeholder-stone-500 focus:border-blue-500/40 focus:ring-1 focus:ring-blue-500/20"
                  : "bg-white border-stone-250 text-[#141822] placeholder-slate-500 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 shadow-inner"
              }`}
            />
          </div>
          
          <div className="shrink-0 font-sans">
            <span 
              style={{
                backgroundColor: theme === "dark" ? "#11365A" : "#EFF6FF",
                color: theme === "dark" ? "#00D3F3" : "#1A365D",
                borderColor: theme === "dark" ? "#1F4A7A" : "#EFF6FF"
              }}
              className="px-2 py-1.5 rounded text-[8px] font-mono font-bold uppercase tracking-wider select-none border inline-block whitespace-nowrap"
            >
              {(() => {
                const list = specificIllnessesDict[selectedPlan] || specificIllnessesDict[Object.keys(specificIllnessesDict).find(k => selectedPlan.includes(k)) || ""] || [];
                return `${list.length} Conditions`;
              })()}
            </span>
          </div>
        </div>
      ) : (
        <p className={`text-[10px] font-bold leading-normal italic select-none font-sans shrink-0 ${theme === "dark" ? "text-slate-400" : "text-slate-500"}`}>
          Please select a policy of choice above.
        </p>
      )}

      {/* Grouped Scroll List (No nested border/background cards, blends directly into the helper container) */}
      <div className="flex-grow flex flex-col min-h-0 w-full">
        {selectedPlan ? (
          (() => {
            const rawList = specificIllnessesDict[selectedPlan] || specificIllnessesDict[Object.keys(specificIllnessesDict).find(k => selectedPlan.includes(k)) || ""] || [];
            const query = illnessSearchQuery.trim().toLowerCase();
            const filtered = rawList.filter(item => 
              item.illness.toLowerCase().includes(query) || 
              (item.category && item.category.toLowerCase().includes(query))
            );

            if (filtered.length === 0) {
              return (
                <div className="text-center py-6 flex-grow flex flex-col justify-center font-sans">
                  <p className={`text-[10px] font-bold ${theme === "dark" ? "text-slate-400" : "text-slate-600"}`}>No matching illnesses</p>
                  <p className={`text-[9.5px] mt-1 italic ${theme === "dark" ? "text-slate-500" : "text-slate-400"}`}>Try a different search keyword</p>
                </div>
              );
            }

            // Group filtered entries by category
            const categories: Record<string, string[]> = {};
            filtered.forEach(item => {
              const cat = item.category || "General";
              if (!categories[cat]) categories[cat] = [];
              categories[cat].push(item.illness);
            });

            return (
              <div className="overflow-y-auto pr-1 space-y-3 custom-scrollbar flex-grow font-sans min-h-0">
                {Object.keys(categories).map(catName => (
                  <div key={catName} className="space-y-1">
                    <span 
                      style={{
                        backgroundColor: theme === "dark" ? "#1E4D7E" : "#EFF6FF",
                        color: theme === "dark" ? "#00D3F3" : "#1A365D",
                        borderColor: theme === "dark" ? "#2D67A4" : "rgba(226, 232, 240, 0.4)"
                      }}
                      className="text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border inline-block select-none"
                    >
                      {catName}
                    </span>
                    <div className="space-y-1 pl-0.5 font-sans">
                      {categories[catName].map((ill, idx) => (
                        <div
                           key={idx}
                           style={{
                             backgroundColor: theme === "dark" ? "#11365A" : "#C7CFD6",
                             borderColor: theme === "dark" ? "#1F4A7A" : "#C7CFD6"
                           }}
                           className={`p-2 rounded-xl text-[10px] font-semibold leading-relaxed border flex items-start gap-1.5 transition-all ${
                             theme === "dark"
                               ? "text-[#E2E8F0] hover:bg-[#143C66] hover:border-[#1F4A7A]"
                               : "hover:bg-slate-200/50"
                           }`}
                        >
                          <span 
                            style={{ backgroundColor: "#00D3F3" }} 
                            className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 animate-pulse" 
                          />
                          <span style={{ color: theme === "dark" ? "#ffffff" : "#1F1F1F" }}>{ill}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()
        ) : (
          <div className="text-center py-8 flex-grow flex items-center justify-center font-sans">
            <span className={`text-[10px] select-none italic font-medium ${theme === "dark" ? "text-slate-500" : "text-slate-400"}`}>
              Select a plan to list details
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default SpecificIllnessLedgerCard;
