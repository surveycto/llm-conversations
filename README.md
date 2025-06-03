# Baseline text field

![Default appearance for the 'baseline-text' field plug-in](extras/preview.jpg)

## Description

A simple replacement for the default *text* field, plus a few improvements (see below). You can either download and use this as-is, or you can use it as a starting template when creating your own field plug-in for a *text* field.

[![Download now](extras/download-button.png)](https://github.com/surveycto/baseline-text/raw/master/baseline-text.fieldplugin.zip)

### Features

In addition to supporting the default SurveyCTO features listed below, this field plug-in offers the following expanded functionality:

1. **Support for HTML in field references** <br>
    If you reference another field's value in either the field *label* or field *hint*, and that referenced value contains HTML, the HTML will be correctly rendered.
1. **Better support for RTL languages** <br>
    The field label, hint, and input will now be justified to the right when they contain an RTL language.

### Data format

This field plug-in requires the `text` field type.

## How to use

### Getting started

**To use this plug-in as-is**, just download the [baseline-text.fieldplugin.zip](https://github.com/surveycto/baseline-text/raw/master/baseline-text.fieldplugin.zip) file from this repo, specify this field plug-in as a custom field appearance in the form design (like in the [test form](https://github.com/surveycto/baseline-text/raw/master/extras/test-form/test-form-package.zip)), and attach it to your form. For more details about using field plug-ins, please read the [user documentation](https://docs.surveycto.com/02-designing-forms/03-advanced-topics/06.using-field-plug-ins.html).

**To create your own** field plug-in using this as a template, follow these steps:

1. Fork this repo
1. Make changes to the files in the `source` directory.  
    * **Note:** be sure to update the `manifest.json` file as well.
1. Zip the updated contents of the `source` directory.
1. Rename the .zip file to *yourpluginname*.fieldplugin.zip (replace *yourpluginname* with the name you want to use for your plug-in).
1. You may then attach your new .fieldplugin.zip file to your form as normal.

For more information about developing your own field plug-ins, please read the [developer documentation](https://github.com/surveycto/Field-plug-in-resources).

### Default SurveyCTO feature support

| Feature / Property | Support |
| --- | --- |
| Supported field type(s) | `text`|
| Default values | Yes |
| Constraint message | Uses default behavior |
| Required message | Uses default behavior |
| Read only | Yes *(shows the current value, if present)* |
| media:image | Yes |
| media:audio | Yes |
| media:video | Yes |
| `numbers` appearance | Yes |
| `numbers_decimal` appearance | Yes |
| `numbers_phone` appearance | Yes |

### Parameters

**Note about the `numbers_decimal` appearance on iOS:**  
iOS has a less-consistent way of determining which on-screen keyboard to display than Android. If you are using this plug-in with the `numbers_decimal` appearance, you should test your form on the actual iOS device that you plan on using. If the wrong keyboard appears (for example, if there is no decimal button available), you may supply an optional parameter to the plug-in to set the keyboard type manually. 

| Parameter key | Parameter value |
| --- | --- |
| `ios-inputmode` | Possible values: `none`, `text`, `decimal`, `numeric`, `tel`, `search`, `email`, `url`. [Click here for more information about the inputmode attribute.](https://css-tricks.com/everything-you-ever-wanted-to-know-about-inputmode)|

## More resources

* **Test form**  
This form will help you explore the differences between this field plug-in and the default text field.  
[Download test form package](https://github.com/surveycto/baseline-text/raw/master/extras/test-form/test-form-package.zip)  
[Instructions for test form](/extras/test-form/README.md)

* **Developer documentation**  
Instructions and resources for developing your own field plug-ins.  
[https://github.com/surveycto/Field-plug-in-resources](https://github.com/surveycto/Field-plug-in-resources)

* **User documentation**  
How to get started using field plug-ins in your SurveyCTO form.  
[https://docs.surveycto.com/02-designing-forms/03-advanced-topics/06.using-field-plug-ins.html](https://docs.surveycto.com/02-designing-forms/03-advanced-topics/06.using-field-plug-ins.html)
