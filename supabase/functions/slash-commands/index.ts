import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabaseClient = createClient(supabaseUrl, supabaseKey);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  try {
    const { action, server_id, command_name, description, options, bot_id, username } = await req.json();

    if (action === "register_command") {
      return await registerCommand(server_id, bot_id, command_name, description, options, username);
    } else if (action === "get_commands") {
      return await getCommands(server_id);
    } else if (action === "execute_command") {
      return await executeCommand(server_id, command_name, options);
    } else if (action === "delete_command") {
      return await deleteCommand(server_id, command_name);
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400 });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});

async function registerCommand(serverId: string, botId: string, commandName: string, description: string, options: any, username: string) {
  try {
    const { data: command, error } = await supabaseClient
      .from("slash_commands")
      .insert({
        server_id: serverId,
        bot_id: botId,
        command_name: commandName,
        description,
        options: options || [],
        created_by: username,
      })
      .select()
      .single();

    if (error) throw error;

    return new Response(JSON.stringify({ success: true, command }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(error);
    throw error;
  }
}

async function getCommands(serverId: string) {
  try {
    const { data: commands, error } = await supabaseClient
      .from("slash_commands")
      .select("*")
      .eq("server_id", serverId)
      .order("command_name");

    if (error) throw error;

    return new Response(JSON.stringify({ commands }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(error);
    throw error;
  }
}

async function executeCommand(serverId: string, commandName: string, params: any) {
  try {
    // Fetch the command
    const { data: command, error: fetchError } = await supabaseClient
      .from("slash_commands")
      .select("*, server_bots(*)")
      .eq("server_id", serverId)
      .eq("command_name", commandName)
      .single();

    if (fetchError) throw new Error("Command not found");

    // Built-in commands
    if (commandName === "help") {
      const { data: allCommands } = await supabaseClient
        .from("slash_commands")
        .select("command_name, description")
        .eq("server_id", serverId);

      const helpText = allCommands
        ?.map((cmd: any) => `**/${cmd.command_name}** - ${cmd.description}`)
        .join("\n") || "No commands available.";

      return new Response(JSON.stringify({ success: true, result: helpText }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (commandName === "ping") {
      return new Response(JSON.stringify({ success: true, result: "🏓 Pong!" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (commandName === "echo") {
      const message = params.message || "Nothing to echo";
      return new Response(JSON.stringify({ success: true, result: message }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Custom command handler (if defined)
    if (command.handler_function) {
      // This would call a custom edge function or webhook
      // For now, just return success
      return new Response(JSON.stringify({ success: true, result: "Command executed" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error("Command has no handler");
  } catch (error) {
    console.error(error);
    throw error;
  }
}

async function deleteCommand(serverId: string, commandName: string) {
  try {
    const { error } = await supabaseClient
      .from("slash_commands")
      .delete()
      .eq("server_id", serverId)
      .eq("command_name", commandName);

    if (error) throw error;

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(error);
    throw error;
  }
}
