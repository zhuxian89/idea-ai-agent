package dev.ideaagent;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

public final class RuntimeShutdownProbe {
    public static void main(String[] args) throws Exception {
        String command = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8)).readLine();
        if (!"shutdown".equals(command)) throw new AssertionError("Unexpected shutdown command: " + command);
    }
}
