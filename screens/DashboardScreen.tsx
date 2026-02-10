import React, { useState } from 'react';
import { Sidebar } from '../components/Sidebar';
import { Header } from '../components/Header';
import { Icon } from '../components/Icon';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  ResponsiveContainer,
  Cell
} from 'recharts';

// Mock Data for the chart
const valuationData = [
  { month: 'JAN', value: 30 },
  { month: 'FEB', value: 40 },
  { month: 'MAR', value: 55 },
  { month: 'APR', value: 50 },
  { month: 'MAY', value: 70 },
  { month: 'JUN', value: 85 },
  { month: 'JUL', value: 80 },
  { month: 'AUG', value: 100 },
];

const DashboardScreen: React.FC = () => {
  const [isSidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background-dark text-slate-100 font-display">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setSidebarOpen(false)} />
      
      <main className="flex-1 flex flex-col relative overflow-y-auto overflow-x-hidden custom-scrollbar">
        <Header onMenuToggle={() => setSidebarOpen(!isSidebarOpen)} />
        
        <div className="p-4 md:p-8 pb-20 max-w-7xl mx-auto w-full">
          
          {/* Summary Stats Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mb-8">
            <StatCard 
              title="Total AUM" 
              value="$420.5M" 
              trend="+12.4% vs LY" 
              trendUp={true} 
              icon="trending_up" 
              delay="0ms"
            />
            <StatCard 
              title="Active Portfolio" 
              value="48 Companies" 
              subtext="Across 4 sectors" 
              icon="business_center" 
              delay="100ms"
            />
            <StatCard 
              title="Fund IRR" 
              value="28.4%" 
              trend="Top Quartile" 
              trendUp={true} 
              icon="workspace_premium" 
              delay="200ms"
            />
            <StatCard 
              title="Dry Powder" 
              value="$82.1M" 
              subtext="Ready for Series A" 
              icon="account_balance_wallet"
              primary={true}
              delay="300ms"
            />
          </div>

          {/* Main Bento Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6 auto-rows-min">
            
            {/* Portfolio Valuation Trend */}
            <div 
              className="lg:col-span-8 glass-panel rounded-xl bento-card p-4 md:p-6 flex flex-col h-[380px] md:h-[424px] animate-fade-in-up"
              style={{ animationDelay: '400ms', animationFillMode: 'both' }}
            >
              <div className="flex flex-col sm:flex-row justify-between items-start mb-6 gap-4">
                <div>
                  <h4 className="text-lg font-bold text-white">Portfolio Valuation Trend</h4>
                  <p className="text-sm text-slate-400">Quarterly growth across all active funds</p>
                </div>
                <div className="flex gap-2">
                  <span className="bg-primary/20 text-primary text-[10px] px-2 py-1 rounded font-bold uppercase cursor-pointer hover:bg-primary/30 transition-colors">Fund I</span>
                  <span className="bg-slate-700 text-slate-300 text-[10px] px-2 py-1 rounded font-bold uppercase cursor-pointer hover:bg-slate-600 transition-colors">Fund II</span>
                </div>
              </div>
              
              <div className="flex-1 min-h-0 w-full mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={valuationData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <XAxis 
                      dataKey="month" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#64748b', fontSize: 10, fontWeight: 'bold' }} 
                      dy={10}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {valuationData.map((entry, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill="#135bec" 
                          fillOpacity={0.3 + (index * 0.1)} 
                          className="hover:fill-primary hover:opacity-100 transition-all duration-300 cursor-pointer"
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Deal Flow Funnel */}
            <div 
              className="lg:col-span-4 glass-panel rounded-xl bento-card p-4 md:p-6 flex flex-col h-[380px] md:h-[424px] animate-fade-in-up"
              style={{ animationDelay: '500ms', animationFillMode: 'both' }}
            >
              <h4 className="text-lg font-bold text-white mb-6">Deal Flow Funnel</h4>
              <div className="flex-1 flex flex-col justify-between">
                <div className="space-y-6">
                  <FunnelRow label="Sourcing" count={124} percent={100} color="bg-blue-600" />
                  <FunnelRow label="Due Diligence" count={18} percent={15} color="bg-blue-500" />
                  <FunnelRow label="IC Review" count={4} percent={4} color="bg-blue-400" />
                  <div className="group cursor-pointer">
                    <div className="flex justify-between text-xs font-bold mb-1 text-primary group-hover:text-primary/80 transition-colors">
                      <span className="font-bold">Closing</span>
                      <span className="font-bold text-white">2</span>
                    </div>
                    <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div className="bg-primary h-full transition-all duration-1000 group-hover:brightness-125" style={{ width: '2%' }}></div>
                    </div>
                  </div>
                </div>
                <button className="mt-6 w-full bg-primary hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/20 text-white font-bold py-3 rounded-lg flex items-center justify-center gap-2 transition-all active:scale-[0.98]">
                  <Icon name="add_circle" className="text-sm" />
                  <span>Create New Deal</span>
                </button>
              </div>
            </div>

            {/* Upcoming Meetings */}
            <div 
              className="lg:col-span-4 glass-panel rounded-xl bento-card p-4 md:p-6 h-[424px] animate-fade-in-up"
              style={{ animationDelay: '600ms', animationFillMode: 'both' }}
            >
              <div className="flex justify-between items-center mb-6">
                <h4 className="text-lg font-bold text-white">Upcoming</h4>
                <button className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-white/5 hover:text-white transition-all active:scale-95">
                  <Icon name="more_horiz" />
                </button>
              </div>
              <div className="space-y-3">
                <MeetingItem 
                  icon="groups" 
                  color="text-orange-500" 
                  bg="bg-orange-500/20"
                  title="NovaHealth Series A" 
                  time="Today, 2:30 PM" 
                  avatars={[
                    "https://lh3.googleusercontent.com/aida-public/AB6AXuBlJS9XZJ5Au1W8j3x5kzNXCZ8JSHaQZ3D9TKRvv4woF36u6sKdMyZGek-ivqKAAqJ2kykPMFaU6EKTikxW5vgIUjDsftybukhEyAXA3uGeW0tOG2xuIPsfRctNIX1fGdWOVJeTmIOAJ1TRVay4iftNnJnPzk21yecV4GxIXx_oDkpYYRG5wyePVGAgSrxSDveoeMrmu-RV1ssRKC7_PsLXLdYeE51ioQ4xsl0F_7wFZsqbzfs2eH5YsZrC4T9WIFfW5suF0AoiBpM",
                    "https://lh3.googleusercontent.com/aida-public/AB6AXuDIE4AG0N2UGXFc1o7988v17sS-g0y1vIvL3aOiqqhaAQyA602dkQcW-sz2DLBoHWouYjnukOiIo1vVJ6VflyQlDz1zL1y36KxMNDcwMJ5VVjGnphcKeHMqe2V6TRQ3AYo0CZYlXafd08yfriNbqk3zcUja5f7J3zuIuqfJpiV0pycuxMN04ztQrFPBCzgzez2pZRrDP3Nr8c-AITR6yaxKAegQLf5be6-XGtZWAy5CU8hITxG0GqxQBSCG3AQ_H3eFve4wJjiadu4"
                  ]}
                  active
                />
                <MeetingItem 
                  icon="gavel" 
                  color="text-emerald-500" 
                  bg="bg-emerald-500/20"
                  title="Legal Review: Quantify" 
                  time="Tomorrow, 10:00 AM" 
                />
                <MeetingItem 
                  icon="event_note" 
                  color="text-purple-500" 
                  bg="bg-purple-500/20"
                  title="LP Quarterly Update" 
                  time="Oct 24, 4:00 PM" 
                />
              </div>
            </div>

            {/* Recent Capital Calls */}
            <div 
              className="lg:col-span-8 glass-panel rounded-xl bento-card p-4 md:p-6 overflow-hidden flex flex-col h-[424px] animate-fade-in-up"
              style={{ animationDelay: '700ms', animationFillMode: 'both' }}
            >
              <div className="flex justify-between items-center mb-6">
                <h4 className="text-lg font-bold text-white">Recent Capital Calls</h4>
                <button className="text-xs font-bold text-primary hover:text-white hover:bg-primary/20 px-3 py-1.5 rounded-md transition-colors uppercase tracking-wider">View All</button>
              </div>
              <div className="flex-1 overflow-auto custom-scrollbar pr-2">
                <table className="w-full text-left min-w-[500px]">
                  <thead className="text-[10px] uppercase font-bold text-slate-500 border-b border-slate-800 sticky top-0 bg-[#161c29]/95 backdrop-blur-sm z-10">
                    <tr>
                      <th className="pb-3 px-2">Entity</th>
                      <th className="pb-3 px-2">Amount</th>
                      <th className="pb-3 px-2">Date</th>
                      <th className="pb-3 px-2">Status</th>
                      <th className="pb-3 px-2">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    <TableRow 
                      entity="Vanguard LP" 
                      subEntity="Fund II - Call #4" 
                      amount="$2,450,000" 
                      date="Oct 12, 2023" 
                      status="FUNDED" 
                      statusColor="text-emerald-500" 
                      statusBg="bg-emerald-500/10"
                      actionIcon="receipt_long"
                    />
                    <TableRow 
                      entity="Meridian Group" 
                      subEntity="Fund II - Call #4" 
                      amount="$1,120,000" 
                      date="Oct 12, 2023" 
                      status="PENDING" 
                      statusColor="text-blue-500" 
                      statusBg="bg-blue-500/10"
                      actionIcon="receipt_long"
                    />
                    <TableRow 
                      entity="Summit Endowments" 
                      subEntity="Fund II - Call #4" 
                      amount="$890,000" 
                      date="Oct 11, 2023" 
                      status="OVERDUE" 
                      statusColor="text-red-500" 
                      statusBg="bg-red-500/10"
                      actionIcon="priority_high"
                    />
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        </div>
      </main>

      {/* Decorative Background Orbs */}
      <div className="fixed top-[-10%] left-[-10%] w-[60%] h-[60%] md:w-[40%] md:h-[40%] bg-primary/20 blur-[150px] rounded-full -z-10 pointer-events-none"></div>
      <div className="fixed bottom-[-10%] right-[-10%] w-[50%] h-[50%] md:w-[30%] md:h-[30%] bg-blue-900/10 blur-[120px] rounded-full -z-10 pointer-events-none"></div>
    </div>
  );
};

// Sub-components

const StatCard = ({ title, value, trend, trendUp, subtext, icon, primary, delay }: any) => (
  <div 
    className="glass-panel p-5 md:p-6 rounded-xl bento-card cursor-pointer group animate-fade-in-up"
    style={{ animationDelay: delay, animationFillMode: 'both' }}
  >
    <p className="text-slate-400 text-sm font-medium mb-1 group-hover:text-slate-300 transition-colors">{title}</p>
    <h3 className="text-2xl font-extrabold text-white group-hover:text-primary transition-colors">{value}</h3>
    <div className={`flex items-center mt-2 text-xs font-bold ${primary ? 'text-primary' : (trendUp ? 'text-emerald-500' : 'text-slate-400')}`}>
      <Icon name={icon} className="text-sm mr-1" />
      <span>{trend || subtext}</span>
    </div>
  </div>
);

const FunnelRow = ({ label, count, percent, color }: { label: string, count: number, percent: number, color: string }) => (
  <div className="group cursor-pointer">
    <div className="flex justify-between text-xs font-bold mb-1">
      <span className="text-slate-400 group-hover:text-slate-200 transition-colors">{label}</span>
      <span className="text-white group-hover:text-primary transition-colors">{count}</span>
    </div>
    <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
      <div className={`${color} h-full transition-all duration-1000 group-hover:brightness-110`} style={{ width: `${percent}%` }}></div>
    </div>
  </div>
);

const MeetingItem = ({ icon, color, bg, title, time, avatars, active }: any) => (
  <div className={`flex items-center gap-3 md:gap-4 p-3 rounded-lg cursor-pointer transition-all duration-300 border ${active ? 'bg-slate-800/60 border-slate-700' : 'bg-transparent border-transparent hover:bg-slate-800/40 hover:border-slate-700/50 hover:translate-x-1'}`}>
    <div className={`${bg} ${color} p-2 rounded-lg`}>
      <Icon name={icon} />
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-sm font-bold truncate text-slate-100">{title}</p>
      <p className="text-xs text-slate-500">{time}</p>
    </div>
    {avatars && (
      <div className="flex -space-x-2">
        {avatars.map((src: string, i: number) => (
          <img key={i} src={src} alt="Avatar" className="w-6 h-6 rounded-full border-2 border-background-dark shadow-sm" />
        ))}
      </div>
    )}
  </div>
);

const TableRow = ({ entity, subEntity, amount, date, status, statusColor, statusBg, actionIcon }: any) => (
  <tr className="group hover:bg-slate-800/30 transition-colors cursor-pointer">
    <td className="py-4 px-2">
      <p className="text-sm font-bold text-slate-200 group-hover:text-primary transition-colors">{entity}</p>
      <p className="text-[10px] text-slate-500">{subEntity}</p>
    </td>
    <td className="py-4 px-2 font-mono text-sm text-slate-300">{amount}</td>
    <td className="py-4 px-2 text-sm text-slate-400">{date}</td>
    <td className="py-4 px-2">
      <span className={`${statusBg} ${statusColor} text-[10px] px-2 py-0.5 rounded-full font-bold tracking-wide`}>
        {status}
      </span>
    </td>
    <td className="py-4 px-2">
      <button className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-white/10 hover:text-white transition-all active:scale-90">
        <Icon name={actionIcon} className="text-lg" />
      </button>
    </td>
  </tr>
);

export default DashboardScreen;