using System;
using TypeShim;

namespace Client.Library;

[TSExport]
public class Echo
{
#if LIBRARY_ALTERED
    public string Greet(string name) => $"Hola, {name}";
#else
    public string Greet(string name) => $"Hello, {name}";
#endif
    public int Add(int a, int b) => a + b;
    public bool BoolNot(bool value) => !value;
    public double Pi() => Math.PI;
}
