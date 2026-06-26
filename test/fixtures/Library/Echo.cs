using System;
using TypeShim;

namespace Client.Library;

[TSExport]
public class Echo
{
    public string Greet(string name) => $"Hello, {name}";
    public int Add(int a, int b) => a + b;
    public bool BoolNot(bool value) => !value;
    public double Pi() => Math.PI;
}
