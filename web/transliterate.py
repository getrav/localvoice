#!/usr/bin/env python3
"""Transliterate Devanagari text to Latin script. Reads JSON from stdin, writes JSON to stdout."""
import sys, json
from indic_transliteration import sanscript

def transliterate_text(text):
    if not text or not any('\u0900' <= c <= '\u097F' for c in text):
        return text
    return sanscript.transliterate(text, sanscript.DEVANAGARI, sanscript.ITRANS)

data = json.load(sys.stdin)
data['text'] = transliterate_text(data.get('text', ''))
for seg in data.get('segments', []):
    seg['text'] = transliterate_text(seg.get('text', ''))
json.dump(data, sys.stdout)
