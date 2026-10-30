package com.voxa.app;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Küçük, bağımsız JSON okuyucu (Android'e bağlı değil, testlenebilir). */
final class MiniJson {
    private final String s;
    private int i = 0;

    private MiniJson(String s) { this.s = s; }

    static Object parse(String text) throws Exception {
        if (text == null) throw new Exception("Boş JSON");
        MiniJson p = new MiniJson(text);
        p.skip();
        Object v = p.value(0);
        p.skip();
        if (p.i != p.s.length()) throw new Exception("JSON sonunda fazlalık var");
        return v;
    }

    private void skip() {
        while (i < s.length()) {
            char c = s.charAt(i);
            if (c == ' ' || c == '\n' || c == '\r' || c == '\t' || c == '\uFEFF') i++; else break;
        }
    }

    private Object value(int depth) throws Exception {
        if (depth > 20) throw new Exception("JSON çok derin");
        if (i >= s.length()) throw new Exception("JSON beklenmedik şekilde bitti");
        char c = s.charAt(i);
        if (c == '{') return object(depth);
        if (c == '[') return array(depth);
        if (c == '"') return string();
        if (s.startsWith("true", i)) { i += 4; return Boolean.TRUE; }
        if (s.startsWith("false", i)) { i += 5; return Boolean.FALSE; }
        if (s.startsWith("null", i)) { i += 4; return null; }
        return number();
    }

    private Map<String, Object> object(int depth) throws Exception {
        Map<String, Object> m = new LinkedHashMap<>();
        i++; skip();
        if (i < s.length() && s.charAt(i) == '}') { i++; return m; }
        while (true) {
            skip();
            if (i >= s.length() || s.charAt(i) != '"') throw new Exception("Anahtar bekleniyordu");
            String k = string();
            skip();
            if (i >= s.length() || s.charAt(i) != ':') throw new Exception(": bekleniyordu");
            i++; skip();
            m.put(k, value(depth + 1));
            skip();
            if (i >= s.length()) throw new Exception("JSON eksik");
            char c = s.charAt(i++);
            if (c == ',') continue;
            if (c == '}') return m;
            throw new Exception("Beklenmeyen karakter");
        }
    }

    private List<Object> array(int depth) throws Exception {
        List<Object> l = new ArrayList<>();
        i++; skip();
        if (i < s.length() && s.charAt(i) == ']') { i++; return l; }
        while (true) {
            skip();
            l.add(value(depth + 1));
            skip();
            if (i >= s.length()) throw new Exception("JSON eksik");
            char c = s.charAt(i++);
            if (c == ',') continue;
            if (c == ']') return l;
            throw new Exception("Beklenmeyen karakter");
        }
    }

    private String string() throws Exception {
        StringBuilder b = new StringBuilder();
        i++; // açılış tırnağı
        while (true) {
            if (i >= s.length()) throw new Exception("Metin kapanmadı");
            char c = s.charAt(i++);
            if (c == '"') return b.toString();
            if (c == '\\') {
                if (i >= s.length()) throw new Exception("Kaçış hatalı");
                char e = s.charAt(i++);
                switch (e) {
                    case '"': b.append('"'); break;
                    case '\\': b.append('\\'); break;
                    case '/': b.append('/'); break;
                    case 'b': b.append('\b'); break;
                    case 'f': b.append('\f'); break;
                    case 'n': b.append('\n'); break;
                    case 'r': b.append('\r'); break;
                    case 't': b.append('\t'); break;
                    case 'u':
                        if (i + 4 > s.length()) throw new Exception("Unicode hatalı");
                        b.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
                        i += 4;
                        break;
                    default: throw new Exception("Bilinmeyen kaçış");
                }
            } else {
                b.append(c);
            }
        }
    }

    private Object number() throws Exception {
        int st = i;
        while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) i++;
        if (st == i) throw new Exception("Geçersiz değer");
        String t = s.substring(st, i);
        if (t.indexOf('.') >= 0 || t.indexOf('e') >= 0 || t.indexOf('E') >= 0) return Double.valueOf(t);
        return Long.valueOf(t);
    }
}
