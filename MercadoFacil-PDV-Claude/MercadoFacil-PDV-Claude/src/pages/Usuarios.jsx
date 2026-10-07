import React, { useState, useEffect } from "react";
import { api } from "@/api/dataClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Shield,
  UserPlus,
  Users,
  ChevronDown,
  Smartphone,
  Mail,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/use-toast";
import InviteDialog from "@/components/users/InviteDialog";
import DeviceTab from "@/components/users/DeviceTab";

export default function Usuarios() {
  const [users, setUsers] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("usuarios");
  const [inviteOpen, setInviteOpen] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [userData, me] = await Promise.all([
        api.entities.User.list(),
        api.auth.me().catch(() => null),
      ]);
      // Filtra apenas usuários da mesma empresa (multi-tenant)
      const myCompanyId = me?.company_id;
      const companyUsers = myCompanyId
        ? userData.filter((u) => u.company_id === myCompanyId)
        : userData;
      setUsers(companyUsers);
      setCurrentUser(me);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    try {
      await api.functions.invoke("assignRole", {
        user_id: userId,
        role: newRole,
      });
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
      );
      toast({
        title: "Papel atualizado",
        description: `Usuário agora é ${newRole === "admin" ? "Administrador" : "Caixa"}.`,
      });
    } catch (e) {
      toast({
        title: "Erro",
        description: e.message || "Não foi possível atualizar o papel.",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const tabs = [
    { value: "usuarios", label: "Usuários", icon: Users },
    { value: "dispositivos", label: "Dispositivos", icon: Smartphone },
  ];

  return (
    <div className="p-4 lg:p-6">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Shield className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-heading font-bold text-foreground">Usuários</h1>
          <p className="text-sm text-muted-foreground">Gerencie a equipe e dispositivos</p>
        </div>
      </div>

      {/* Tabs + Novo button */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="inline-flex p-1 rounded-full bg-muted gap-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.value;
            return (
              <button
                key={tab.value}
                onClick={() => setActiveTab(tab.value)}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all",
                  active
                    ? "bg-primary text-primary-foreground shadow"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
        {activeTab === "usuarios" && (
          <Button
            onClick={() => setInviteOpen(true)}
            className="gap-2 rounded-full"
          >
            <UserPlus className="w-4 h-4" />
            Novo
          </Button>
        )}
      </div>

      {/* Content */}
      {activeTab === "usuarios" ? (
        <div className="space-y-2">
          {users.length === 0 ? (
            <Card className="p-12 text-center text-muted-foreground">
              <Users className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Nenhum usuário.</p>
            </Card>
          ) : (
            users.map((u) => {
              const isMe = currentUser && u.id === currentUser.id;
              return (
                <Card
                  key={u.id}
                  className="p-4 flex items-center gap-3 hover:shadow-md transition-shadow cursor-pointer"
                >
                  <div className="w-11 h-11 rounded-xl bg-primary flex items-center justify-center shrink-0">
                    <span className="text-base font-semibold text-primary-foreground">
                      {(u.full_name || u.email || "U").charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-foreground truncate">
                        {u.full_name || "Sem nome"}
                      </span>
                      {isMe && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          Você
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Mail className="w-3 h-3" /> {u.email}
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        disabled={isMe}
                        className={cn(
                          "flex items-center gap-1.5 px-2 py-1 rounded-lg text-sm font-medium transition-colors",
                          isMe ? "text-muted-foreground cursor-default" : "text-primary hover:bg-primary/10"
                        )}
                      >
                        {u.role === "admin" ? "Administrador" : "Caixa"}
                        <ChevronDown className="w-4 h-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Alterar papel</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => handleRoleChange(u.id, "admin")}
                        className="gap-2"
                      >
                        <Shield className="w-4 h-4" />
                        Administrador
                        {u.role === "admin" && <Check className="w-4 h-4 ml-auto" />}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleRoleChange(u.id, "user")}
                        className="gap-2"
                      >
                        <Users className="w-4 h-4" />
                        Caixa
                        {u.role === "user" && <Check className="w-4 h-4 ml-auto" />}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </Card>
              );
            })
          )}
        </div>
      ) : (
        <DeviceTab currentUser={currentUser} />
      )}

      <InviteDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onInvited={loadData}
      />
    </div>
  );
}