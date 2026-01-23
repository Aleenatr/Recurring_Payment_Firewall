import { useState, useEffect } from "react";
import { RiRobot2Line } from "react-icons/ri";
import { useNavigate } from "react-router-dom";

interface Pattern {
  type: string;
  severity: string;
  evidence: string;
  confidence: number;
  data_points: number;
}

interface MerchantData {
  merchantId: string;
  merchantName: string;
  category: string;
  riskAssessment: {
    trustScore: number;
    riskLevel: string;
    confidence: number;
    isOutlier: boolean;
  };
  signals?: {
    price_volatility?: number;
    price_change_frequency?: number;
    stealth_price_changes?: number;
    rename_frequency?: number;
    cancellation_friction?: number;
    retry_aggressiveness?: number;
  };
  supportingData?: {
    price_change_frequency?: string;
    chargeback_rate?: number;
    dispute_rate?: number;
    notification_compliance?: string;
    descriptor_stability?: string;
  };
  patternsDetected: Pattern[];
  summary: {
    headline: string;
    oneLineReason: string;
  };
  recommendedAction: {
    primary: string;
    urgency: string;
    severity?: string;
    nextSteps?: string[];
  };
  metadata: {
    generated_at: string;
  };
}

const Dashboard = () => {
  const navigate = useNavigate();
  const [merchants, setMerchants] = useState<MerchantData[]>([]);
  const [filteredMerchants, setFilteredMerchants] = useState<MerchantData[]>(
    [],
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [selectedRiskLevel, setSelectedRiskLevel] = useState<string>("ALL"); 
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedMerchant, setSelectedMerchant] = useState<MerchantData | null>(
    null,
  );
  const [aiAnalysis, setAiAnalysis] = useState<string>("");
  const [loadingAI, setLoadingAI] = useState(false);

  useEffect(() => {
    fetchMerchants();
  }, []);

  useEffect(() => {
    filterMerchants();
  }, [searchTerm, selectedRiskLevel, merchants]);

  const fetchMerchants = async () => {
    try {
      setLoading(true);
      console.log('Fetching merchants from API...');
      const response = await fetch(
        "http://localhost:5000/api/public/merchants?limit=100",
        {
          cache: 'no-cache',
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      if (result.success && result.data && result.data.length > 0) { 
        setMerchants(result.data);
        setFilteredMerchants(result.data);
        setLastFetched(new Date());
      } else { 
        setMerchants([]);
        setFilteredMerchants([]);
        setLastFetched(new Date());
      }
    } catch (error) { 
      setMerchants([]);
      setFilteredMerchants([]);
    } finally {
      setLoading(false);
    }
  };

  const filterMerchants = () => {
    let filtered = merchants;

    // Filter by search term
    if (searchTerm) {
      filtered = filtered.filter(
        (m) =>
          m.merchantName.toLowerCase().includes(searchTerm.toLowerCase()) ||
          m.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
          m.merchantId.toLowerCase().includes(searchTerm.toLowerCase()),
      );
      console.log("After search filter:", filtered.length);
    }

    // Filter by risk level
    if (selectedRiskLevel !== "ALL") {
      filtered = filtered.filter(
        (m) => m.riskAssessment.riskLevel === selectedRiskLevel,
      );
      console.log("After risk filter:", filtered.length);
    }

    console.log("Final filtered count:", filtered.length);
    setFilteredMerchants(filtered);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-blue-600 mb-4"></div>
          <p className="text-xl text-gray-700 font-semibold">
            Loading merchant data...
          </p>
        </div>
      </div>
    );
  }

  const getRiskBadgeClass = (risk: string) => {
    switch (risk) {
      case "CRITICAL":
        return "bg-red-100 text-red-800 border-red-300";
      case "HIGH_RISK":
        return "bg-orange-100 text-orange-800 border-orange-300";
      case "NEEDS_ATTENTION":
        return "bg-amber-100 text-amber-800 border-amber-300";
      case "HEALTHY":
        return "bg-green-100 text-green-800 border-green-300";
      default:
        return "bg-gray-100 text-gray-800 border-gray-300";
    }
  };

  const getTrustLabel = (riskLevel: string) => {
    switch (riskLevel) {
      case "CRITICAL":
        return { label: "High Risk", icon: "🔴", color: "text-red-600" };
      case "HIGH_RISK":
        return { label: "Risky", icon: "🟠", color: "text-orange-600" };
      case "NEEDS_ATTENTION":
        return { label: "Needs Attention", icon: "🟡", color: "text-amber-600" };
      case "HEALTHY":
        return { label: "Safe", icon: "🟢", color: "text-green-600" };
      default:
        return { label: "Unknown", icon: "⚪", color: "text-gray-600" };
    }
  };

  const getActionIcon = (urgency: string) => {
    switch (urgency.toUpperCase()) {
      case "URGENT":
        return "❌";
      case "HIGH":
        return "👀";
      case "MEDIUM":
        return "👀";
      case "LOW":
        return "✅";
      default:
        return "👀";
    }
  };

  const handleAIAnalysis = async (merchant: MerchantData) => {
    setSelectedMerchant(merchant);
    setIsModalOpen(true);
    setLoadingAI(true);
    setAiAnalysis("");

    try {
      console.log("Requesting AI analysis for merchant:", merchant.merchantId);
      const response = await fetch(
        `http://localhost:5000/api/public/merchants/${merchant.merchantId}/ai-analysis`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      console.log("Response status:", response.status);
      const result = await response.json();
      console.log("Response data:", result);

      if (!response.ok) {
        throw new Error(result.message || "Failed to generate AI analysis");
      }

      if (result.success && result.data) {
        setAiAnalysis(result.data.analysis);
      } else {
        throw new Error("Invalid response format");
      }
    } catch (error) {
      console.error("Error fetching AI analysis:", error);
      setAiAnalysis(
        `Unable to generate AI analysis at this time. ${error instanceof Error ? error.message : "Please try again later."}`,
      );
    } finally {
      setLoadingAI(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-start justify-between mb-4">
            <button
              onClick={() => navigate("/")}
              className="text-gray-600 cursor-pointer hover:text-gray-500 font-semibold inline-flex items-center gap-2 transition-colors"
            >
              Back to Home
            </button>
          </div>
          <h1 className="text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-[#f25d25] to-[#f25d25] mb-3">
            Merchant Analysis Dashboard
          </h1>
          <p className="text-lg text-gray-600">
            Real-time monitoring of recurring payment patterns
          </p>
        </div>

        {/* Controls Section */}
        <div className="bg-white rounded-sm shadow-xs p-6 mb-8">
          <div className="flex flex-col md:flex-row gap-4 mb-4">
            <div className="flex-1 relative">
              <input
                type="text"
                placeholder="Search by merchant name, category, or ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-3 pr-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-sm"
              />
            </div>

            <select
              value={selectedRiskLevel}
              onChange={(e) => setSelectedRiskLevel(e.target.value)}
              className="px-3 py-2 border-2 rounded-md focus:outline-none text-sm font-medium cursor-pointer bg-white"
            >
              <option value="ALL">All Risk Levels</option>
              <option value="CRITICAL">Critical</option>
              <option value="HIGH_RISK">High Risk</option>
              <option value="NEEDS_ATTENTION">Needs Attention</option>
              <option value="HEALTHY">Healthy</option>
            </select>

            <button
              onClick={fetchMerchants}
              className="px-4 rounded-md py-2 bg-[#f25d25] transition-all font-semibold text-sm shadow-xs hover:shadow-sm"
            >
              Refresh
            </button>
          </div>

          {lastFetched && (
            <div className="flex items-center text-gray-600">
              <p>
                Last updated:{" "}
                <span className="font-semibold text-gray-800">
                  {lastFetched.toLocaleTimeString()}
                </span>{" "}
                on{" "}
                <span className="font-semibold text-gray-800">
                  {lastFetched.toLocaleDateString()}
                </span>
              </p>
            </div>
          )}
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-sm shadow-xs p-6 border-l-4 border-l-blue-500 hover:shadow-md transition-shadow">
            <div className="text-sm text-gray-600 mb-1 font-medium">
              Total Merchants
            </div>
            <div className="text-4xl font-bold text-blue-600">
              {filteredMerchants.length}
            </div>
          </div>
          <div className="bg-white rounded-sm shadow-xs p-6 border-l-4 border-l-red-500 hover:shadow-md transition-shadow">
            <div className="text-sm text-gray-600 mb-1 font-medium">
              Critical Risk
            </div>
            <div className="text-4xl font-bold text-red-600">
              {
                filteredMerchants.filter(
                  (m) => m.riskAssessment.riskLevel === "CRITICAL",
                ).length
              }
            </div>
          </div>
          <div className="bg-white rounded-sm shadow-xs p-6 border-l-4 border-l-orange-500 hover:shadow-md transition-shadow">
            <div className="text-sm text-gray-600 mb-1 font-medium">
              High Risk
            </div>
            <div className="text-4xl font-bold text-orange-600">
              {
                filteredMerchants.filter(
                  (m) => m.riskAssessment.riskLevel === "HIGH_RISK",
                ).length
              }
            </div>
          </div>
          <div className="bg-white rounded-sm shadow-xs p-6 border-l-4 border-l-green-500 hover:shadow-md transition-shadow">
            <div className="text-sm text-gray-600 mb-1 font-medium">
              Healthy
            </div>
            <div className="text-4xl font-bold text-green-600">
              {
                filteredMerchants.filter(
                  (m) => m.riskAssessment.riskLevel === "HEALTHY",
                ).length
              }
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredMerchants.map((merchant, index) => {
            const trustInfo = getTrustLabel(merchant.riskAssessment.riskLevel);

            return (
              <div
                key={index}
                className="bg-white relative rounded-sm shadow-xs hover:shadow-sm transition-all duration-300 border border-gray-200"
              >
                {/* AI & Details Buttons */}
                <div className="absolute top-4 right-4 flex gap-2 z-10">
                  <button
                    onClick={() => handleAIAnalysis(merchant)}
                    className="p-2 bg-[#f25d25] rounded-xs transition-all shadow-sm hover:shadow-md hover:bg-[#d94d1f] focus:outline-none focus:ring-2 focus:ring-[#f25d25] cursor-pointer focus:ring-offset-1"
                    title="AI Assistant"
                  >
                    <RiRobot2Line size={16} color="white" />
                  </button>
                </div>
                {/* Card Header */}
                <div className="p-5 pb-4">
                  <h3 className="text-xl font-bold text-gray-900 mb-1 leading-tight">
                    {merchant.merchantName}
                  </h3>
                  <p className="text-xs text-gray-500 font-medium">
                    {merchant.category}
                  </p>
                </div>

                {/* Trust Indicator */}
                <div className="px-5 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <div className={`text-xl font-black ${trustInfo.color}`}>
                        {trustInfo.label}
                      </div>
                      <div className="text-xs text-gray-600 font-medium">
                        Trust Score:{" "}
                        <span className="text-gray-900 font-bold">
                          {merchant.riskAssessment.trustScore}/100
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Recommended Action */}
                <div className="px-5 pb-4">
                  <div className="bg-gray-50 rounded- p-3 border border-gray-200">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                        Recommended Action
                      </span>
                    </div>
                    <div className="text-sm font-bold text-gray-900 leading-tight">
                      {merchant.recommendedAction.primary}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* No Results */}
        {filteredMerchants.length === 0 && (
          <div className="bg-white rounded-xl shadow-lg p-12 text-center">
            <p className="text-xl text-gray-600 font-semibold">
              No merchants found matching your criteria.
            </p>
            <p className="text-gray-500 mt-2">
              Try adjusting your search or filter settings.
            </p>
          </div>
        )}
      </div>

      {/* AI Analysis Modal */}
      {isModalOpen && selectedMerchant && (
        <div className="fixed inset-0 backdrop-blur-sm bg-black/10 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xs shadow-sm max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="bg-[#f25d25] text-white p-6 sticky top-0">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <RiRobot2Line size={28} />
                    <h2 className="text-2xl font-bold">AI Analysis</h2>
                  </div>
                  <p className="text-sm opacity-90">
                    Understanding your subscription:{" "}
                    <span className="font-bold">
                      {selectedMerchant.merchantName}
                    </span>
                  </p>
                </div>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="text-white hover:bg-white/20 rounded-xs p-2 transition-all"
                  title="Close"
                >
                  <span className="text-2xl font-bold">×</span>
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6">
              {/* Merchant Info Card */}
              <div className="bg-gray-50 rounded-xs p-4 mb-6 border border-gray-200">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-600">Category:</span>
                    <span className="ml-2 font-semibold text-gray-900">
                      {selectedMerchant.category}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-600">Trust Score:</span>
                    <span className="ml-2 font-bold text-[#f25d25]">
                      {selectedMerchant.riskAssessment.trustScore}/100
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-600">Risk Level:</span>
                    <span
                      className={`ml-2 font-semibold ${getTrustLabel(selectedMerchant.riskAssessment.riskLevel).color}`}
                    >
                      {
                        getTrustLabel(selectedMerchant.riskAssessment.riskLevel)
                          .label
                      }
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-600">Merchant ID:</span>
                    <span className="ml-2 font-mono text-xs text-gray-900">
                      {selectedMerchant.merchantId}
                    </span>
                  </div>
                </div>
              </div>

              {/* Merchant Behavior Section */}
              <div className="mb-6">
                <h3 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <span>📊</span>
                  <span>Merchant Behavior Analysis</span>
                </h3>

                {/* Summary */}
                <div className="bg-blue-50 border-l-4 border-blue-500 rounded-xs p-4 mb-4">
                  <h4 className="font-bold text-gray-900 mb-1">
                    {selectedMerchant.summary.headline}
                  </h4>
                  <p className="text-sm text-gray-700">
                    {selectedMerchant.summary.oneLineReason}
                  </p>
                </div>

                {/* Patterns Detected */}
                {selectedMerchant.patternsDetected &&
                  selectedMerchant.patternsDetected.length > 0 && (
                    <div className="mb-4">
                      <h4 className="text-sm font-bold text-gray-900 mb-2 uppercase tracking-wide">
                        ⚠️ Detected Patterns
                      </h4>
                      <div className="space-y-2">
                        {selectedMerchant.patternsDetected.map(
                          (pattern, idx) => (
                            <div
                              key={idx}
                              className="bg-red-50 border border-red-200 rounded-xs p-3"
                            >
                              <div className="flex items-start justify-between mb-1">
                                <span className="font-bold text-red-800 text-xs uppercase">
                                  {pattern.type.replace(/_/g, " ")}
                                </span>
                                <span className="text-xs px-2 py-0.5 bg-red-200 text-red-800 rounded-xs font-semibold">
                                  {pattern.severity}
                                </span>
                              </div>
                              <p className="text-sm text-gray-700 mb-1">
                                {pattern.evidence}
                              </p>
                              <div className="flex justify-between text-xs text-gray-600">
                                <span>
                                  Confidence:{" "}
                                  {(pattern.confidence * 100).toFixed(0)}%
                                </span>
                                <span>Data Points: {pattern.data_points}</span>
                              </div>
                            </div>
                          ),
                        )}
                      </div>
                    </div>
                  )}

                {/* Supporting Data */}
                {selectedMerchant.supportingData && (
                  <div className="mb-4">
                    <h4 className="text-sm font-bold text-gray-900 mb-2 uppercase tracking-wide">
                      📈 Supporting Data
                    </h4>
                    <div className="grid grid-cols-2 gap-2">
                      {selectedMerchant.supportingData
                        .price_change_frequency && (
                        <div className="bg-white border border-gray-200 rounded-xs p-2">
                          <div className="text-xs text-gray-600">
                            Price Changes
                          </div>
                          <div className="font-bold text-gray-900">
                            {
                              selectedMerchant.supportingData
                                .price_change_frequency
                            }
                          </div>
                        </div>
                      )}
                      {selectedMerchant.supportingData
                        .notification_compliance && (
                        <div className="bg-white border border-gray-200 rounded-xs p-2">
                          <div className="text-xs text-gray-600">
                            Notification Rate
                          </div>
                          <div className="font-bold text-gray-900">
                            {
                              selectedMerchant.supportingData
                                .notification_compliance
                            }
                          </div>
                        </div>
                      )}
                      {selectedMerchant.supportingData.descriptor_stability && (
                        <div className="bg-white border border-gray-200 rounded-xs p-2">
                          <div className="text-xs text-gray-600">
                            Descriptor Stability
                          </div>
                          <div className="font-bold text-gray-900">
                            {
                              selectedMerchant.supportingData
                                .descriptor_stability
                            }
                          </div>
                        </div>
                      )}
                      {selectedMerchant.supportingData.chargeback_rate !==
                        undefined && (
                        <div className="bg-white border border-gray-200 rounded-xs p-2">
                          <div className="text-xs text-gray-600">
                            Chargeback Rate
                          </div>
                          <div className="font-bold text-gray-900">
                            {selectedMerchant.supportingData.chargeback_rate}%
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* AI Analysis Content */}
              <div className="mb-6">
                <h3 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <span>💡</span>
                  <span>AI-Powered Explanation</span>
                </h3>

                {loadingAI ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-[#f25d25] mb-4"></div>
                    <p className="text-gray-600 font-medium">
                      AI is analyzing your subscription...
                    </p>
                  </div>
                ) : (
                  <div className="bg-white border border-gray-200 rounded-xs p-4">
                    <div className="text-gray-700 leading-relaxed whitespace-pre-wrap text-sm">
                      {aiAnalysis}
                    </div>
                  </div>
                )}
              </div>

              {/* Recommended Action */}
              {!loadingAI && (
                <div className="bg-[#f25d25]/10 border-l-4 border-[#f25d25] rounded-xs p-4">
                  <h4 className="text-sm font-bold text-gray-900 mb-2 uppercase tracking-wide">
                    ✅ Recommended Action
                  </h4>
                  <p className="text-base font-bold text-gray-900 mb-2">
                    {selectedMerchant.recommendedAction.primary}
                  </p>
                  <p className="text-sm text-gray-600 mb-3">
                    Urgency:{" "}
                    <span className="font-semibold text-[#f25d25]">
                      {selectedMerchant.recommendedAction.urgency}
                    </span>
                  </p>

                  {selectedMerchant.recommendedAction.nextSteps &&
                    selectedMerchant.recommendedAction.nextSteps.length > 0 && (
                      <div>
                        <h5 className="text-xs font-bold text-gray-700 mb-2 uppercase">
                          Next Steps:
                        </h5>
                        <ol className="list-decimal list-inside space-y-1">
                          {selectedMerchant.recommendedAction.nextSteps.map(
                            (step, idx) => (
                              <li key={idx} className="text-sm text-gray-700">
                                {step}
                              </li>
                            ),
                          )}
                        </ol>
                      </div>
                    )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
