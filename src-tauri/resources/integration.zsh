# AureliaSpace shell integration: emits OSC markers the terminal uses to build
# command blocks.
#   OSC 133;A        prompt start
#   OSC 133;C        command output start
#   OSC 133;D;<code> command finished
#   OSC 6973;cmd;<base64>  command text
#   OSC 6973;cwd;<base64>  working directory
[[ -n "$_AURELIA_LOADED" ]] && return
typeset -g _AURELIA_LOADED=1
typeset -g _aurelia_running=

_aurelia_b64() { builtin printf '%s' "$1" | command base64 | command tr -d '\n' }

_aurelia_precmd() {
  local ret=$?
  if [[ -n "$_aurelia_running" ]]; then
    builtin printf '\e]133;D;%s\a' "$ret"
    _aurelia_running=
  fi
  builtin printf '\e]6973;cwd;%s\a' "$(_aurelia_b64 "$PWD")"
  builtin printf '\e]133;A\a'
}

_aurelia_preexec() {
  _aurelia_running=1
  builtin printf '\e]6973;cmd;%s\a\e]133;C\a' "$(_aurelia_b64 "$1")"
}

# Runs on the first prompt, after the user's rc files, so our precmd goes first
# (it must see the command's exit status) even if the rc rewrote the hook arrays.
_aurelia_install() {
  precmd_functions=(${precmd_functions:#_aurelia_install})
  precmd_functions=(_aurelia_precmd ${precmd_functions:#_aurelia_precmd})
  preexec_functions=(${preexec_functions:#_aurelia_preexec} _aurelia_preexec)
  _aurelia_precmd
}
typeset -ga precmd_functions preexec_functions
precmd_functions+=(_aurelia_install)

# Route every `claude` started in this pane through the AureliaSpace hook settings,
# so the agent panel can track its status, and give it the app's MCP server
# (DeepSeek subagents). `--mcp-config=` keeps the variadic flag from swallowing
# the arguments after it. A thread stamped for long-session compression never falls
# through to plain `claude`: it runs `bili claude --bin`, or it stops.
if [[ -n "$AURELIA_CLAUDE_SETTINGS" ]]; then
  claude() {
    local -a settings
    settings=(--settings "$AURELIA_CLAUDE_SETTINGS")
    if [[ -r "$AURELIA_CLAUDE_MCP" ]]; then
      settings+=(--mcp-config="$AURELIA_CLAUDE_MCP")
    fi
    if [[ -n "$AURELIA_CONTEXT_COMPRESSION" ]]; then
      if [[ -n "$AURELIA_COMPRESSION_BLOCK" ]]; then
        builtin print -u2 -- "AureliaCode: $AURELIA_COMPRESSION_BLOCK"
        return 1
      fi
      if [[ ! -x "$AURELIA_BILI_WRAP" || ! -x "$AURELIA_BILI" || ! -x "$AURELIA_CLAUDE_BIN" ]]; then
        builtin print -u2 -- "AureliaCode: long-session compression is on for this thread, but billion-context isn't available. Install it in Settings → Accounts, or start a thread with compression off. Claude was not started."
        return 1
      fi
      builtin print -u2 -- "AureliaCode: long-session compression is on. This session is forwarded to your existing Claude provider; compressed context stays on this Mac."
      command "$AURELIA_BILI_WRAP" "$AURELIA_BILI" --host 127.0.0.1 --no-auto-update --bin "$AURELIA_CLAUDE_BIN" claude -- "${settings[@]}" "$@"
      return
    fi
    command claude "${settings[@]}" "$@"
  }
fi
