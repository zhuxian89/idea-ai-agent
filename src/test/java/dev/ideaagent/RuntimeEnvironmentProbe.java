package dev.ideaagent;

import java.util.List;
import java.util.concurrent.TimeUnit;

/** Runs in the actual child environment, without contacting an Agent or model. */
public final class RuntimeEnvironmentProbe {
    public static void main(String[] args) throws Exception {
        if (!"terminal custom value".equals(System.getenv("IDE_AGENT_TEST_SHELL_VALUE"))) {
            throw new AssertionError("The runtime did not inherit the terminal environment");
        }
        for (String command : List.of("codex", "claude", "node")) {
            var arguments = System.getProperty("os.name").startsWith("Windows")
                ? List.of("cmd.exe", "/d", "/c", command) : List.of(command);
            var child = new ProcessBuilder(arguments).redirectErrorStream(true).start();
            try {
                if (!child.waitFor(5, TimeUnit.SECONDS)) throw new AssertionError("CLI lookup timed out");
                if (child.exitValue() != 0) throw new AssertionError("CLI not found: " + command);
                System.out.print(new String(child.getInputStream().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8));
            } finally {
                if (child.isAlive()) child.destroyForcibly();
            }
        }
    }
}
