import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { startLogin } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import {
  BookOpenCheck,
  ClipboardList,
  FileCheck2,
  FileText,
  LayoutDashboard,
  LogOut,
  Megaphone,
  PanelLeft,
  ShieldCheck,
  Timer,
  Wrench,
} from "lucide-react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";

const staffItems = [
  { icon: LayoutDashboard, label: "Staff home", path: "/staff" },
  { icon: ShieldCheck, label: "WHS library", path: "/staff/whs" },
  { icon: FileCheck2, label: "WHS Draft Studio", path: "/staff/whs-drafts" },
  { icon: ClipboardList, label: "EC forms", path: "/staff/forms" },
  { icon: FileCheck2, label: "My projects", path: "/staff/projects" },
  { icon: Timer, label: "Timesheets", path: "/staff/timesheets" },
  { icon: BookOpenCheck, label: "Training", path: "/staff/training" },
  { icon: Megaphone, label: "Noticeboard", path: "/staff/noticeboard" },
  { icon: FileText, label: "BOSTA Stage 1", path: "/staff/bosta" },
];

const adminItems = [{ icon: Wrench, label: "Admin control centre", path: "/admin" }];

export default function DashboardLayout({ children, portalKind = "staff" }: { children: React.ReactNode; portalKind?: "staff" | "admin" }) {
  const { loading, user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const isMobile = useIsMobile();

  if (loading) return <DashboardLayoutSkeleton />;
  if (!user) {
    return (
      <main className="signin-shell">
        <section className="signin-card">
          <div className="brand-mark"><span>EC</span></div>
          <p className="eyebrow">Ecology Consulting</p>
          <h1>{portalKind === "admin" ? "Admin Portal" : "Staff Portal"}</h1>
          <p>{portalKind === "admin" ? "Secure administration of organisational content, requests and allocations." : "Secure access to your work, resources, projects and communications."}</p>
          <Button onClick={() => startLogin()} size="lg" className="ec-primary-button">Sign in to the portal</Button>
        </section>
      </main>
    );
  }

  const menuItems = portalKind === "admin" ? adminItems : staffItems;
  const active = menuItems.find(item => item.path === location)?.label ?? (portalKind === "admin" ? "Admin Portal" : "Staff Portal");

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" className="ec-sidebar border-r-0">
        <SidebarHeader className="ec-sidebar-header">
          <button className="brand-lockup" onClick={() => setLocation(portalKind === "admin" ? "/admin" : "/staff")} aria-label={portalKind === "admin" ? "Go to Admin Portal" : "Go to Staff Portal"}>
            <span className="brand-mark-small">EC</span>
            <span className="brand-name">Ecology<br /><em>Consulting</em></span>
          </button>
          <button className="sidebar-collapse" onClick={() => document.querySelector<HTMLButtonElement>("[data-sidebar=trigger]")?.click()} aria-label="Collapse navigation">
            <PanelLeft size={16} />
          </button>
        </SidebarHeader>
        <SidebarContent className="ec-sidebar-content">
          <p className="sidebar-section-label">{portalKind === "admin" ? "Administration" : "Staff workspace"}</p>
          <SidebarMenu className="px-3">
            {menuItems.map(item => (
              <SidebarMenuItem key={item.path}>
                <SidebarMenuButton
                  isActive={location === item.path}
                  onClick={() => setLocation(item.path)}
                  tooltip={item.label}
                  className="ec-nav-item"
                >
                  <item.icon size={17} />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
          <div className="sidebar-support-card">
            <ShieldCheck size={16} />
            <span>{portalKind === "admin" ? "Governance and review protect the whole team." : "Safety and quality are shared responsibilities."}</span>
          </div>
        </SidebarContent>
        <SidebarFooter className="ec-sidebar-footer">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="profile-control">
                <Avatar className="h-9 w-9 border-0 bg-[#dcebd5] text-[#173920]">
                  <AvatarFallback className="bg-[#dcebd5] text-[#173920] text-xs font-bold">{user.name?.charAt(0).toUpperCase() ?? "E"}</AvatarFallback>
                </Avatar>
                <span className="profile-copy">
                  <strong>{user.name || "Ecology team member"}</strong>
                  <small>{user.role === "admin" ? "Administrator" : "Staff member"}</small>
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={logout} className="cursor-pointer text-destructive focus:text-destructive">
                <LogOut size={15} className="mr-2" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="ec-main-inset">
        {isMobile && (
          <header className="mobile-portal-header">
            <SidebarTrigger data-sidebar="trigger" aria-label="Open navigation" />
            <span>{active}</span>
            <span className="mobile-ec">EC</span>
          </header>
        )}
        <main className="portal-main">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
