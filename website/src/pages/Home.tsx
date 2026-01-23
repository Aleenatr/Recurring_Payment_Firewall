import { useNavigate } from "react-router-dom";
import Payment from "../assets/payment_miss.jpeg";

const Home = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-gray-50 to-slate-100">
      {/* Navigation */}
      <nav className="bg-white/80 backdrop-blur-md shadow-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-gray-900">
              Subscription Firewall
            </span>
          </div>
          <button
            onClick={() => navigate("/dashboard")}
            className="px-6 py-2 bg-[#f25d25] text-white rounded-xs font-semibold hover:bg-[#d94d1f] shadow-sm transition-all"
          >
            View Dashboard
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <div className="container mx-auto px-4 py-20">
        <div className="grid md:grid-cols-2 gap-12 items-center mb-16 max-w-6xl mx-auto">
          {/* Left Side - Text Content */}
          <div className="text-left">
            <h1 className="text-5xl md:text-6xl font-black text-gray-900 mb-6 leading-tight">
              Stop Paying for
              <span className="block text-[#f25d25]">Subscription Abuse</span>
            </h1>
            <p className="text-lg md:text-xl text-gray-600 mb-8 leading-relaxed">
              Our intelligent firewall detects predatory billing patterns, hidden
              price increases, and suspicious merchant behavior before they drain
              your wallet.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 mb-8">
              <button
                onClick={() => navigate("/dashboard")}
                className="px-8 py-4 bg-[#f25d25] text-white rounded-xs text-lg font-bold shadow-sm hover:bg-[#d94d1f] transform hover:scale-105 transition-all duration-300 flex items-center gap-2 justify-center"
              >
                <span>Analyze Your Subscriptions</span>
                <span className="text-2xl">→</span>
              </button>
              <button className="px-8 py-4 bg-white text-gray-900 rounded-xs text-lg font-bold shadow-sm hover:shadow-sm border-2 border-gray-200 transition-all">
                Watch Demo
              </button>
            </div>

            {/* Trust Indicators */}
            <div className="flex flex-wrap gap-6 text-sm text-gray-600">
              <div className="flex items-center gap-2">
                <span className="text-green-600 font-bold text-xl">✓</span>
                <span>Real-time Monitoring</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-green-600 font-bold text-xl">✓</span>
                <span>ML-Powered Detection</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-green-600 font-bold text-xl">✓</span>
                <span>Privacy First</span>
              </div>
            </div>
          </div>

          {/* Right Side - Image */}
          <div className="flex justify-center items-center">
            <img 
              src={Payment} 
              alt="Payment Protection Illustration" 
              className="w-64 rounded-xs shadow-sm"
            />
          </div>
        </div>

        {/* Stats Section */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-20 max-w-5xl mx-auto">
          <div className="bg-white rounded-xs p-6 text-center shadow-sm border border-gray-100">
            <div className="text-4xl font-black text-[#f25d25] mb-2">$2.1B</div>
            <div className="text-sm text-gray-600 font-medium">
              Lost to subscription abuse annually
            </div>
          </div>
          <div className="bg-white rounded-xs p-6 text-center shadow-sm border border-gray-100">
            <div className="text-4xl font-black text-[#f25d25] mb-2">76%</div>
            <div className="text-sm text-gray-600 font-medium">
              Users unaware of price increases
            </div>
          </div>
          <div className="bg-white rounded-xs p-6 text-center shadow-sm border border-gray-100">
            <div className="text-4xl font-black text-[#f25d25] mb-2">42%</div>
            <div className="text-sm text-gray-600 font-medium">
              Experience silent price creep
            </div>
          </div>
          <div className="bg-white rounded-xs p-6 text-center shadow-sm border border-gray-100">
            <div className="text-4xl font-black text-[#f25d25] mb-2">3.2x</div>
            <div className="text-sm text-gray-600 font-medium">
              Average price increase over 2 years
            </div>
          </div>
        </div>

        {/* Problem Section */}
        <div className="bg-white rounded-xs shadow-sm p-12 mb-20 max-w-5xl mx-auto border border-gray-200">
          <div className="text-center mb-10">
            <h2 className="text-4xl font-black text-gray-900 mb-4">
              The Hidden Threat
            </h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Merchants use sophisticated tactics to maximize recurring revenue
              without your knowledge.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-[#f25d25]/5 border-l-4 border-[#f25d25] rounded-xs p-6 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="text-3xl">🚨</span>
                <div>
                  <h3 className="font-bold text-gray-900 text-lg mb-2">
                    Silent Price Increases
                  </h3>
                  <p className="text-sm text-gray-700 leading-relaxed">
                    Prices raised without notification, buried in fine print, or
                    disguised as "plan upgrades"
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-[#f25d25]/5 border-l-4 border-[#f25d25] rounded-xs p-6 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="text-3xl">💰</span>
                <div>
                  <h3 className="font-bold text-gray-900 text-lg mb-2">
                    Price Creep
                  </h3>
                  <p className="text-sm text-gray-700 leading-relaxed">
                    Gradual $1-2 increases every few months that compound to
                    200%+ over time
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-[#f25d25]/5 border-l-4 border-[#f25d25] rounded-xs p-6 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="text-3xl">🎭</span>
                <div>
                  <h3 className="font-bold text-gray-900 text-lg mb-2">
                    Identity Evasion
                  </h3>
                  <p className="text-sm text-gray-700 leading-relaxed">
                    Frequent name changes to avoid detection and make
                    cancellation harder
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-[#f25d25]/5 border-l-4 border-[#f25d25] rounded-xs p-6 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="text-3xl">🔍</span>
                <div>
                  <h3 className="font-bold text-gray-900 text-lg mb-2">
                    Descriptor Confusion
                  </h3>
                  <p className="text-sm text-gray-700 leading-relaxed">
                    Vague billing names and constantly changing descriptors to
                    hide charges
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* How It Works */}
        <div className="mb-20 max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-black text-gray-900 mb-4">
              How Subscription Firewall Works
            </h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Advanced AI monitors every transaction, analyzes patterns, and
              alerts you to suspicious behavior
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-white rounded-xs p-8 border border-gray-200 shadow-sm">
              <div className="w-16 h-16 bg-[#f25d25] rounded-xs flex items-center justify-center text-3xl mb-6 shadow-sm">
                📊
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-3">
                1. Continuous Analysis
              </h3>
              <p className="text-gray-700 leading-relaxed mb-4">
                We monitor all recurring transactions in real-time, tracking
                price changes, billing patterns, and merchant behavior.
              </p>
              <ul className="space-y-2 text-sm text-gray-700">
                <li className="flex items-center gap-2">
                  <span className="text-[#f25d25]">▸</span>
                  Transaction frequency tracking
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-[#f25d25]">▸</span>
                  Price volatility detection
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-[#f25d25]">▸</span>
                  Merchant name monitoring
                </li>
              </ul>
            </div>

            <div className="bg-white rounded-xs p-8 border border-gray-200 shadow-sm">
              <div className="w-16 h-16 bg-[#f25d25] rounded-xs flex items-center justify-center text-3xl mb-6 shadow-sm">
                🤖
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-3">
                2. AI Pattern Detection
              </h3>
              <p className="text-gray-700 leading-relaxed mb-4">
                Machine learning algorithms identify suspicious patterns and
                assign risk scores based on millions of data points.
              </p>
              <ul className="space-y-2 text-sm text-gray-700">
                <li className="flex items-center gap-2">
                  <span className="text-[#f25d25]">▸</span>
                  Behavioral clustering (DBSCAN)
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-[#f25d25]">▸</span>
                  Anomaly detection (K-means)
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-[#f25d25]">▸</span>
                  Risk scoring algorithms
                </li>
              </ul>
            </div>

            <div className="bg-white rounded-xs p-8 border border-gray-200 shadow-sm">
              <div className="w-16 h-16 bg-[#f25d25] rounded-xs flex items-center justify-center text-3xl mb-6 shadow-sm">
                🛡️
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-3">
                3. Instant Protection
              </h3>
              <p className="text-gray-700 leading-relaxed mb-4">
                Get actionable insights and recommendations to protect yourself
                from predatory practices.
              </p>
              <ul className="space-y-2 text-sm text-gray-700">
                <li className="flex items-center gap-2">
                  <span className="text-[#f25d25]">▸</span>
                  Real-time risk alerts
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-[#f25d25]">▸</span>
                  Clear action recommendations
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-[#f25d25]">▸</span>
                  One-click cancellation guidance
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Features Grid */}
        <div className="mb-20 max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-black text-gray-900 mb-4">
              Comprehensive Protection
            </h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: "⚡",
                title: "Real-time Monitoring",
                desc: "24/7 surveillance of all recurring charges",
              },
              {
                icon: "🎯",
                title: "95% Accuracy",
                desc: "Industry-leading pattern detection",
              },
              {
                icon: "🔒",
                title: "Privacy First",
                desc: "Your data never leaves your control",
              },
              {
                icon: "📱",
                title: "Instant Alerts",
                desc: "Get notified of suspicious activity",
              },
              {
                icon: "📊",
                title: "Visual Dashboard",
                desc: "Easy-to-understand risk visualization",
              },
              {
                icon: "🤝",
                title: "Expert Guidance",
                desc: "AI-powered recommendations",
              },
            ].map((feature, idx) => (
              <div
                key={idx}
                className="bg-white rounded-xs p-6 shadow-sm border border-gray-200 hover:shadow-sm transition-shadow"
              >
                <div className="text-4xl mb-3">{feature.icon}</div>
                <h3 className="font-bold text-gray-900 text-lg mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-gray-600">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* CTA Section */}
        <div className="bg-[#f25d25] rounded-xs p-12 text-center text-white shadow-sm max-w-4xl mx-auto">
          <h2 className="text-4xl font-black mb-4">Ready to Take Control?</h2>
          <p className="text-xl mb-8 opacity-90">
            Join thousands protecting themselves from subscription abuse
          </p>
          <button
            onClick={() => navigate("/dashboard")}
            className="px-10 py-4 bg-white text-[#f25d25] rounded-xs text-lg font-bold shadow-sm hover:shadow-sm transform hover:scale-105 transition-all"
          >
            Start Analyzing Now →
          </button>
        </div>
      </div>
    </div>
  );
};

export default Home;
